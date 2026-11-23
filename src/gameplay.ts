import * as THREE from 'three';
import { Gfx } from './engine/renderer';
import { Input } from './engine/input';
import { GameAudio } from './engine/audio';
import { clamp, makeNoiseTexture } from './engine/noise';
import { createTerrain, type Terrain } from './world/terrain';
import { SKY_HORIZON, SUN_COLOR, SUN_DIR, applySkyLook, buildEnvironment, createSky, type Sky } from './world/sky';
import { Water } from './world/water';
import type { Area, AreaKey, MissionDef, PortalDef } from './world/area';
import { HILL, PLAZA, TOWN_TERRAIN, Town } from './world/areas/town';
import { STAGE_INFO, type StageKey } from './world/areas/stage-catalog';
import { Particles } from './game/particles';
import { Player } from './game/player';
import { FollowCamera } from './game/camera';
import { Collectibles } from './game/collectibles';
import { Enemies } from './game/enemies';
import { Npcs } from './game/npc';
import { Portals } from './game/portals';
import { $, Hud, type MissionView } from './game/hud';
import { ALL_GEMS, GEM_COUNT, formatTime, loadSettings, type SaveData } from './game/state';
import type { User } from './net/api';
import type { Panels } from './front/panels';

interface GameCallbacks {
  onSave(save: SaveData, syncCloud: boolean): void;
  onMenu(): void;
  canRank(): boolean;
  onError?(error: unknown): void;
  panels: Panels;
}

type Mode = 'idle' | 'playing' | 'paused' | 'cutscene' | 'select' | 'ending';

const REVEAL_TEXT: Record<number, string> = {
  0: '広場がピカピカに！ 噴水の上に ヒカリ石が あらわれた！',
  2: 'ヒトデをぜんぶ見つけた！ ビーチに ヒカリ石が あらわれた！',
  4: 'スミボウをやっつけた！ 広場に ヒカリ石が あらわれた！',
};
const LANDMARK: Record<StageKey, string> = { volcano: '時計塔', lagoon: '港の倉庫', plateau: '丘のふもとの石の門' };

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const bitCount = (n: number) => { let c = 0; for (let i = 0; i < 16; i++) if (n & (1 << i)) c++; return c; };

/** 1つのエリアと、その中で動くもの一式 */
interface World {
  area: Area;
  items: Collectibles;
  enemies: Enemies;
  npcs: Npcs;
  portals: Portals | null;
}

export class Game {
  private readonly gfx: Gfx;
  private readonly input: Input;
  private readonly audio = new GameAudio();
  private readonly hud = new Hud();
  private settings = loadSettings();
  private terrain!: Terrain;
  private sky!: Sky;
  private hemi!: THREE.HemisphereLight;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private water!: Water;
  private particles!: Particles;
  private player!: Player;
  private cam!: FollowCamera;
  /** 町は一度作ったら持ち続け、ステージは入るたびに作り直す */
  private town!: World;
  private cur!: World;
  private stage: { key: StageKey; episode: number; revealed: boolean } | null = null;
  private selecting: StageKey | null = null;
  private switching = false;
  private timeUniforms: { value: number }[] = [];
  private mode: Mode = 'idle';
  private session = 0;
  private frameId: number | null = null;
  private save!: SaveData;
  private user: User | null = null;
  private saveDirty = false;
  private cloudDirty = false;
  private savedPlayMs = 0;
  private saveTimer = 0;
  private time = 0;
  private last = performance.now();
  private pendingJump = false;
  private combo = 0;
  private comboT = 0;
  private cleanSoundT = 0;
  private hintT = 0;
  private cut: { kind: 'gem' | 'reveal' | 'faint' | 'look'; id: number; t: number; dur: number; angle: number; at?: THREE.Vector3; newBest?: boolean } | null = null;
  private wasLocked = false;
  private readonly tmp = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, private readonly callbacks: GameCallbacks) {
    this.gfx = new Gfx(canvas);
    this.input = new Input(canvas, $('touch'));
  }

  // ───────────────────────── 起動 ─────────────────────────
  async init(): Promise<void> {
    const { gfx } = this;
    const loading = $('loadingText');
    await nextFrame();
    const noise = makeNoiseTexture(256);
    noise.anisotropy = gfx.anisotropy;
    this.terrain = createTerrain(noise);
    this.terrain.apply(TOWN_TERRAIN);
    loading.textContent = '町をつくっています…';
    await nextFrame();

    this.sky = createSky(noise);
    this.water = new Water(noise, this.terrain.heightTex, this.terrain.heightUV);
    this.particles = new Particles();
    gfx.scene.add(this.sky.mesh, this.terrain.mesh, this.water.mesh, this.particles.points);
    gfx.scene.fog = new THREE.FogExp2(SKY_HORIZON.getHex(), 0.0007);
    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x8a7a55, 0.55);
    gfx.scene.add(this.hemi);
    gfx.attachWater(this.water);
    this.timeUniforms = [this.terrain.uniforms.uTime, this.sky.uniforms.uTime, this.water.uniforms.uTime as { value: number }];

    this.town = this.makeWorld(new Town());
    this.cur = this.town;
    loading.textContent = 'プカをよんでいます…';
    await nextFrame();
    this.player = new Player(this.town.area, this.particles);
    this.cam = new FollowCamera(gfx.camera, this.town.area.colliders);
    gfx.scene.add(this.player.group);
    this.attach(this.town);

    gfx.onTierChange = () => this.applyDetail();
    this.applySettings();

    // シェーダーを先にコンパイルして、遊び始めの引っかかりをなくす
    const spawn = this.town.area.spawn;
    this.cam.snap(spawn.x, spawn.y, spawn.z, 0);
    this.cam.update(1, spawn.x, spawn.y, spawn.z, 0, 0, 0, 0, 0, false);
    gfx.followShadow(this.tmp.set(PLAZA.x, PLAZA.y, PLAZA.z), SUN_DIR);
    try {
      await gfx.renderer.compileAsync(gfx.scene, gfx.camera);
    } catch {
      /* 非対応環境では通常どおり初回描画時にコンパイルされる */
    }
    this.wireGameplay();
    this.wireUi();
  }

  // ───────────────────────── エリアの切り替え ─────────────────────────
  private makeWorld(area: Area): World {
    const items = new Collectibles(area, this.particles);
    const enemies = new Enemies(area, this.particles);
    const npcs = new Npcs(area);
    const portals = area.portals.length ? new Portals(area, this.particles) : null;
    const { audio, hud } = this;
    items.onShell = () => {
      this.combo = this.comboT > 0 ? this.combo + 1 : 0;
      this.comboT = 1.2;
      audio.shell(this.combo);
      if (this.player.hp < this.player.maxHp) this.player.hp++;
      this.markDirty();
    };
    items.onStar = () => {
      audio.star();
      const n = items.starCount, all = area.starfish.length;
      hud.toast(n >= all ? 'ヒトデを ぜんぶ見つけた！' : `ヒトデ ${n}/${all}`, 2);
      this.markDirty();
    };
    items.onGem = (id) => this.collectGem(id);
    items.onRefill = () => {
      this.player.tank = this.player.tankMax;
      audio.splash(0.5);
      hud.toast('水が満タンになった！', 1.4);
    };
    enemies.onHit = () => audio.enemyHit();
    enemies.onHop = () => audio.enemyHop();
    enemies.onDefeat = (remaining) => {
      audio.enemyPop();
      if (remaining > 0) hud.toast(`スミボウ あと ${remaining} ひき`, 1.8);
    };
    npcs.onTalk = () => audio.talk();
    npcs.onWet = () => audio.jump(1.4);
    if (portals) {
      portals.onHit = () => audio.enemyHit();
      portals.onOpen = (p) => this.portalOpened(p);
    }
    return { area, items, enemies, npcs, portals };
  }

  private attach(w: World): void {
    const { gfx } = this;
    gfx.scene.add(w.area.root, w.items.root, w.enemies.root, w.npcs.root);
    if (w.portals) gfx.scene.add(w.portals.root);
    this.terrain.uniforms.tGoop.value = w.area.goop.tex;
    this.terrain.uniforms.uGoopRect.value.copy(w.area.goop.rect);
    this.player.level = w.area;
    this.cam.colliders = w.area.colliders;
    this.water.hideInReflection.length = 0;
    this.water.hideInReflection.push(this.particles.points, ...w.area.detailMeshes);
    // 空と光をこのエリアの時間帯に合わせる
    const look = w.area.look;
    applySkyLook(look);
    gfx.sun.color.copy(SUN_COLOR);
    gfx.sun.intensity = look.sunIntensity;
    this.hemi.intensity = look.hemi;
    const fog = gfx.scene.fog as THREE.FogExp2;
    fog.color.copy(SKY_HORIZON);
    fog.density = look.fog;
    this.envRT?.dispose();
    this.envRT = buildEnvironment(gfx.renderer, this.sky);
    gfx.scene.environment = this.envRT.texture;
    gfx.scene.environmentIntensity = 0.55;
    this.cur = w;
    this.applyDetail();
  }

  private detach(w: World): void {
    this.gfx.scene.remove(w.area.root, w.items.root, w.enemies.root, w.npcs.root);
    if (w.portals) this.gfx.scene.remove(w.portals.root);
  }

  private detachCurrent(): void {
    const old = this.cur;
    this.detach(old);
    if (old === this.town) return;
    old.area.dispose();
    old.items.dispose();
    old.enemies.dispose();
    old.npcs.dispose();
  }

  /** 暗転をはさんで別のエリアへ移る。episode はステージ番号（町へ戻るときは不要） */
  async enterArea(key: AreaKey, episode = 0, then?: () => void): Promise<void> {
    if (this.mode === 'idle' || this.switching) return;
    const session = this.session;
    this.switching = true;
    this.flushSave(false);
    const prevMode = this.mode;
    this.mode = 'cutscene';
    this.cut = null;
    this.player.frozen = true;
    const fade = $('fade');
    fade.classList.remove('dark');
    fade.classList.add('on');
    this.audio.reveal();
    const fadeTime = new Promise<void>(resolve => window.setTimeout(resolve, 520));
    // メニューと町だけで起動し、初めてしるしを通る暗転中に地区の造形を取得する。
    const loadWorld = key === 'town' ? null : import('./world/areas/stages').then(({ STAGE_WORLDS }) => ({
      key, ...STAGE_WORLDS[key],
    }));
    let destination;
    try {
      [destination] = await Promise.all([loadWorld, fadeTime]);
    } catch {
      if (session !== this.session) return;
      this.switching = false;
      this.player.frozen = false;
      this.mode = prevMode;
      this.last = performance.now();
      fade.classList.remove('on');
      if (key !== 'town' && this.cur === this.town && prevMode === 'playing') {
        this.openEpisodes(key);
        $('epBlurb').textContent = '地区を読み込めませんでした。通信を確かめて、続く場合はページを再読み込みしてください。';
      } else {
        this.hud.toast('地区を読み込めませんでした。ページを再読み込みしてください。', 5);
      }
      return;
    }

    if (session !== this.session) return;
    const from = this.stage?.key ?? null;
    let world = this.town;
    try {
      this.terrain.apply(destination?.terrain ?? TOWN_TERRAIN);
      if (destination) world = this.makeWorld(destination.create(episode));
    } catch (error) {
      this.terrain.apply(this.cur.area.terrain);
      this.fail(error);
      return;
    }
    this.detachCurrent();
    this.stage = destination ? { key: destination.key, episode, revealed: false } : null;
    this.attach(world);
    if (!destination) {
      this.applyTownState(false, false, false);
      // 出てきた入口の前に立たせる
      const p = this.tmp;
      let yaw = Math.PI;
      if (from && this.town.portals) {
        yaw = this.town.portals.exitPoint(from, p);
        this.town.portals.hold(from, 2.5);
      } else p.copy(this.town.area.spawn);
      this.player.teleport(p.x, p.y + 0.6, p.z, yaw);
      this.cam.snap(p.x, p.y, p.z, yaw);
    } else {
      world.items.restore(this.save.shells, 0, () => false, (id) => !world.area.gems.find((g) => g.id === id)?.hidden);
      world.enemies.spawnAll();
      const sp = world.area.spawn;
      this.player.teleport(sp.x, sp.y, sp.z, world.area.spawnYaw);
      this.cam.snap(sp.x, sp.y, sp.z, world.area.spawnYaw + Math.PI);
      this.player.tank = this.player.tankMax;
      this.player.hp = this.player.maxHp;
    }
    this.player.invuln = 0;
    this.player.frozen = false;
    this.particles.update(100, this.cur.area.goop, this.cur.area.colliders); // 前のエリアの粒を消す
    this.hud.setBubble(null, '', null, this.gfx.camera);
    this.mode = prevMode === 'ending' ? prevMode : 'playing';
    this.switching = false;
    this.last = performance.now();
    fade.classList.remove('on');
    if (key !== 'town') {
      const m = this.cur.area.missions[0];
      this.hud.toast(`${this.cur.area.name}　ステージ${episode + 1}「${m.title}」`, 4);
    } else {
      // 町へ戻ったとき、ヒカリ石が増えていれば あたらしい建物がスミに覆われる
      const appeared = this.town.portals?.sync(bitCount(this.save.gems), this.save.portals) ?? [];
      if (appeared.length && !then && this.mode === 'playing') this.announcePortal(appeared[0]);
    }
    then?.();
  }

  // ───────────────────────── ゲーム内イベントの配線 ─────────────────────────
  private wireGameplay(): void {
    const { audio, player, particles, hud } = this;
    player.onEvent = (e, s) => {
      if (e === 'jump') audio.jump(s);
      else if (e === 'land') { audio.land(s); if (s > 0.7) this.cam.addShake(0.12 * s); }
      else if (e === 'splash') audio.splash(s);
      else if (e === 'step') audio.step(s);
      else if (e === 'hurt') { audio.hurt(); this.cam.addShake(0.35); }
      else if (e === 'empty') { audio.empty(); hud.toast('水がなくなった！ 海や噴水で補給しよう', 2.4); }
    };
    particles.onSprayHit = (x, y, z) => this.cur.enemies.hitTest(x, y, z) || this.cur.npcs.hitTest(x, y, z) || !!this.cur.portals?.hitTest(x, y, z);
    particles.onClean = () => {
      if (this.cleanSoundT <= 0) { audio.clean(); this.cleanSoundT = 0.05; }
    };
    // 読み込みが長く、上陸ボタンのユーザー操作が失効したブラウザでも、次の操作で音を開始する。
    const unlockAudio = () => { if (this.mode === 'playing') audio.start(); };
    window.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
    window.addEventListener('keydown', unlockAudio, true);
    this.input.onLockChange = (locked) => {
      if (locked && this.mode !== 'playing' && this.mode !== 'cutscene') {
        document.exitPointerLock();
        return;
      }
      if (!locked && this.wasLocked && this.mode === 'playing') this.pause();
      this.wasLocked = locked;
    };
    document.addEventListener('visibilitychange', () => {
      if (this.mode === 'idle') return;
      if (document.hidden) {
        if (this.mode === 'playing') this.pause();
        this.audio.suspend();
      } else if (this.mode !== 'paused') this.audio.resume();
    });
    window.addEventListener('pagehide', () => this.flushSave(true));
  }

  // ───────────────────────── セーブ ─────────────────────────
  private markDirty(): void {
    this.cloudDirty = this.saveDirty = true;
  }

  private collectSave(): void {
    if (!this.cur) return;
    // 貝がらは全エリア通しの番号。いまいるエリアのぶんだけ差し替える
    const { area, items } = this.cur;
    const lo = area.shellBase, hi = lo + area.shells.length;
    this.save.shells = [...this.save.shells.filter((i) => i < lo || i >= hi), ...items.shellList];
    if (this.cur === this.town) this.save.stars = items.starBits;
    this.save.updatedAt = Math.max(Date.now(), this.save.updatedAt);
  }

  private flushSave(cloud: boolean): void {
    if (this.mode === 'idle') return;
    const playMs = Math.floor(this.save.playMs);
    const upload = cloud && this.cloudDirty;
    if (!this.saveDirty && !upload && playMs === this.savedPlayMs) return;
    this.collectSave();
    // 時間だけ進んでポーズした場合は端末に記録し、収集・クリア時にクラウドにも送る。
    this.callbacks.onSave({ ...this.save, playMs, shells: [...this.save.shells] }, upload);
    this.savedPlayMs = playMs;
    this.saveDirty = false;
    if (upload) this.cloudDirty = false;
  }

  /** セーブデータの内容を町に反映する */
  private applyTownState(resetPlayer: boolean, quiet: boolean, syncPortals = true): void {
    const s = this.save;
    const { area, items, enemies, portals } = this.town;
    items.restore(s.shells, s.stars, (id) => (s.gems & (1 << id)) !== 0, (id) => (s.revealed & (1 << id)) !== 0);
    if (s.revealed & 1) area.goop.clearAll();
    else if (resetPlayer) area.goop.reset();
    if (s.revealed & 16) enemies.clear();
    else if (resetPlayer || enemies.list.length === 0) enemies.spawnAll();
    if (portals && syncPortals) {
      if (quiet) portals.reset();
      const appeared = portals.sync(bitCount(s.gems), s.portals);
      if (!quiet && appeared.length && this.mode !== 'idle') this.announcePortal(appeared[0]);
    }
    if (resetPlayer) {
      const sp = area.spawn;
      this.player.teleport(sp.x, sp.y, sp.z, Math.PI);
      this.player.hp = this.player.maxHp;
      this.player.tank = this.player.tankMax;
      this.player.invuln = 0;
      this.player.frozen = false;
      this.cam.snap(sp.x, sp.y, sp.z, 0);
    }
  }

  /** スロットを選んだときだけ、町を準備して描画を再開する。 */
  startAdventure(save: SaveData, user: User | null): void {
    if (this.mode !== 'idle') return;
    this.session++;
    this.save = { ...save, shells: [...save.shells] };
    this.user = user;
    if (this.cur !== this.town) {
      this.detachCurrent();
      this.terrain.apply(TOWN_TERRAIN);
      this.stage = null;
      this.attach(this.town);
    }
    this.applyTownState(true, true);
    this.particles.update(100, this.cur.area.goop, this.cur.area.colliders);
    this.hud.setBubble(null, '', null, this.gfx.camera);
    this.time = 0;
    this.saveDirty = this.cloudDirty = false;
    this.savedPlayMs = Math.floor(save.playMs);
    this.saveTimer = this.combo = this.comboT = this.cleanSoundT = 0;
    this.pendingJump = false;
    this.hintT = 14;
    this.input.reset();
    this.input.poll(); // メニューを閉じたキーの押下をゲームへ引き継がない
    this.settings = loadSettings();
    this.applySettings();
    this.audio.start();
    this.audio.ui();
    this.hud.setHint(null);
    this.hud.show(true);
    this.mode = 'playing';
    this.input.enabled = true;
    // 旧版では最後の石の演出中に閉じると、クリアタイムだけが保存されなかった。
    if (this.save.gems === ALL_GEMS && this.save.bestMs === null) {
      const newBest = this.recordClearTime();
      this.flushSave(true);
      this.finishGame(newBest);
    } else {
      this.gfx.canvas.focus();
      if (this.input.device === 'keyboard' && matchMedia('(pointer: fine)').matches && navigator.userActivation?.isActive) this.input.requestLock();
    }
    this.last = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  /** セーブ先を切り替える前に現スロットへ反映し、メニュー中は描画も操作も止める。 */
  leaveAdventure(): void {
    if (this.mode === 'idle') return;
    try {
      this.flushSave(true);
    } finally {
      this.mode = 'idle';
      this.session++;
      this.switching = false;
      this.cut = null;
      this.selecting = null;
      if (this.frameId !== null) cancelAnimationFrame(this.frameId);
      this.frameId = null;
      this.input.enabled = false;
      this.input.reset();
      this.wasLocked = false;
      if (this.input.locked) document.exitPointerLock();
      this.audio.setContinuous(false, false, 1);
      this.audio.suspend();
      this.hud.show(false);
      for (const id of ['pause', 'episodes', 'gemGet', 'ending']) $(id).classList.add('hidden');
      $('fade').classList.remove('dark', 'on');
      $('toast').classList.remove('show');
      if (this.callbacks.panels.isOpen) this.callbacks.panels.close();
      this.callbacks.onMenu();
    }
  }

  private pause(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.input.enabled = false;
    this.input.reset();
    this.hud.renderMissions(this.missionViews());
    $('pauseTitle').textContent = this.stage ? `${this.cur.area.name}　ステージ${this.stage.episode + 1}` : `ヒカリ島の町　ヒカリ石 ${bitCount(this.save.gems)}/${GEM_COUNT}`;
    $('btnExitStage').classList.toggle('hidden', !this.stage);
    $('pause').classList.remove('hidden');
    $('touch').classList.add('hidden');
    $('btnResume').focus();
    this.audio.setContinuous(false, false, 1);
    this.flushSave(true);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private resume(): void {
    if (this.mode !== 'paused') return;
    this.audio.start();
    this.audio.ui();
    $('pause').classList.add('hidden');
    $('touch').classList.remove('hidden');
    this.mode = 'playing';
    this.input.enabled = true;
    this.input.reset();
    this.last = performance.now();
    this.gfx.canvas.focus();
    if (this.input.device === 'keyboard') this.input.requestLock();
  }

  private wireUi(): void {
    const on = (id: string, fn: () => void) => $(id).addEventListener('click', () => {
      if (this.mode !== 'idle') fn();
    });
    const panels = this.callbacks.panels;
    on('btnPauseHow', () => panels.open('how', $('btnPauseHow')));
    on('btnPauseSettings', () => panels.open('settings', $('btnPauseSettings')));
    on('btnResume', () => this.resume());
    on('btnToTitle', () => this.leaveAdventure());
    on('btnExitStage', () => {
      this.resume();
      void this.enterArea('town');
    });
    on('btnEpBack', () => this.cancelEpisodes());
    on('btnEndContinue', () => { $('ending').classList.add('hidden'); this.hud.show(true); this.mode = 'paused'; this.resume(); });
    on('btnEndRank', () => panels.open('rank', $('btnEndRank')));
    on('btnEndNew', () => this.leaveAdventure());
  }

  refreshSettings(): void {
    this.settings = loadSettings();
    if (this.mode !== 'idle') this.applySettings();
  }

  private applySettings(): void {
    const s = this.settings;
    if (this.gfx.mode !== s.quality) this.gfx.setMode(s.quality);
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.audio.setVolume(s.volume);
    this.audio.setMusicVolume(s.music);
    this.applyDetail();
  }

  /** 低品質では草むらなどの飾りを省いて描画を軽くする */
  private applyDetail(): void {
    const detail = this.gfx.tier !== 'low';
    if (!this.cur) return;
    this.player.setDetail(detail);
    for (const m of this.cur.area.detailMeshes) m.visible = detail;
    for (const m of this.cur.area.softShadow) m.castShadow = detail;
  }

  get graphicsDescription(): string {
    const st = this.gfx.stats;
    const tier = { low: '低', medium: '中', high: '高' }[st.tier];
    return `いまの描画: ${st.width}×${st.height}（品質 ${tier}）／ どの設定でも 1280×720 相当を下回りません`;
  }

  // ───────────────────────── 入口とステージ選択 ─────────────────────────
  /** 建物がスミに覆われたことを知らせる（その建物へカメラを向ける） */
  private announcePortal(p: PortalDef): void {
    this.hud.toast(`たいへん！ ${LANDMARK[p.area as StageKey]}が スミのかたまりに のまれた！`, 4.5);
    this.audio.hurt();
    this.cut = { kind: 'look', id: p.index, t: 0, dur: 3.2, angle: p.yaw + 0.5, at: p.pos.clone() };
    this.mode = 'cutscene';
    this.player.frozen = true;
  }

  private portalOpened(p: PortalDef): void {
    this.save.portals |= 1 << p.index;
    this.markDirty();
    this.flushSave(false);
    this.audio.gem();
    this.hud.toast(`${p.label}への入口が ひらいた！ しるしに飛びこもう`, 4.5);
    this.cut = { kind: 'look', id: p.index, t: 0, dur: 3.0, angle: p.yaw - 0.4, at: p.pos.clone() };
    this.mode = 'cutscene';
    this.player.frozen = true;
  }

  /** 入口に飛びこんだ: ステージを選ぶ画面を出す */
  private openEpisodes(key: StageKey): void {
    const info = STAGE_INFO[key];
    this.selecting = key;
    this.mode = 'select';
    this.input.enabled = false;
    this.input.reset();
    this.audio.setContinuous(false, false, 1);
    this.audio.reveal();
    if (document.pointerLockElement) document.exitPointerLock();
    $('epName').textContent = info.name;
    $('epBlurb').textContent = info.blurb;
    const list = $('epList');
    list.innerHTML = '';
    info.missions.forEach((m, i) => {
      const done = (this.save.gems & (1 << m.gem)) !== 0;
      // 前のステージをクリアすると次が選べるようになる
      const open = i === 0 || (this.save.gems & (1 << info.missions[i - 1].gem)) !== 0;
      const b = document.createElement('button');
      if (done) b.className = 'done';
      b.disabled = !open;
      const num = document.createElement('i');
      num.textContent = done ? '✓' : String(i + 1);
      const title = document.createElement('span');
      title.textContent = open ? m.title : '？？？';
      const note = document.createElement('small');
      note.textContent = done ? 'ゲット！' : open ? '' : '前のステージをクリア';
      b.append(num, title, note);
      b.onclick = () => this.chooseEpisode(i);
      list.append(b);
    });
    $('episodes').classList.remove('hidden');
    $('touch').classList.add('hidden');
    list.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  private chooseEpisode(i: number): void {
    const key = this.selecting;
    if (!key) return;
    this.selecting = null;
    $('episodes').classList.add('hidden');
    $('touch').classList.remove('hidden');
    this.audio.ui();
    this.mode = 'playing';
    this.input.enabled = true;
    this.gfx.canvas.focus();
    if (this.input.device === 'keyboard') this.input.requestLock();
    this.enterArea(key, i);
  }

  private cancelEpisodes(): void {
    const key = this.selecting;
    if (!key) return;
    this.selecting = null;
    $('episodes').classList.add('hidden');
    $('touch').classList.remove('hidden');
    this.audio.ui();
    // 入口の前まで下がらせて、すぐまた吸いこまれないようにする
    const portals = this.town.portals;
    if (portals) {
      const yaw = portals.exitPoint(key, this.tmp);
      portals.hold(key, 2);
      this.player.teleport(this.tmp.x, this.tmp.y + 0.6, this.tmp.z, yaw);
    }
    this.mode = 'playing';
    this.input.enabled = true;
    this.input.reset();
    this.last = performance.now();
    this.gfx.canvas.focus();
    if (this.input.device === 'keyboard') this.input.requestLock();
  }

  // ───────────────────────── ミッション ─────────────────────────
  private isRevealed(gem: number): boolean {
    if (this.stage) return this.stage.revealed || !this.cur.area.gems.find((g) => g.id === gem)?.hidden;
    return (this.save.revealed & (1 << gem)) !== 0;
  }

  private progressText(m: MissionDef): string {
    const { area, items, enemies } = this.cur;
    if (m.kind === 'clean') return `${Math.floor(area.goop.progress * 100)}%`;
    if (m.kind === 'defeat') return `あと${enemies.alive}ひき`;
    if (m.kind === 'collect') return `${items.starCount}/${area.starfish.length}`;
    return '';
  }

  private missionViews(): MissionView[] {
    const g = this.save.gems;
    if (this.stage) {
      const info = STAGE_INFO[this.stage.key];
      return info.missions.map((m, i) => {
        const now = i === this.stage!.episode;
        const done = (g & (1 << m.gem)) !== 0;
        return { title: `${i + 1}. ${m.title}`, detail: done ? 'ゲット！' : now ? this.progressText(m) : '', done, now };
      });
    }
    return this.cur.area.missions.map((m) => {
      const done = (g & (1 << m.gem)) !== 0;
      return { title: m.title, detail: done ? 'ゲット！' : this.isRevealed(m.gem) && m.kind !== 'reach' ? 'あらわれた！' : this.progressText(m), done };
    });
  }

  private currentObjective(): string {
    const s = this.save, b = this.player.body;
    if (this.stage) {
      const m = this.cur.area.missions[0];
      if (this.stage.revealed) return '<b>ヒカリ石</b>が あらわれた！';
      const p = this.progressText(m);
      return p ? `${m.hint}　<b>${p}</b>` : m.hint;
    }
    if (s.gems === ALL_GEMS) return '';
    // 出現したのにまだ取っていないヒカリ石を最優先で案内する
    for (const [id, where] of [[0, '噴水の上'], [4, '広場'], [2, 'ビーチ']] as const) {
      if (s.revealed & (1 << id) && !(s.gems & (1 << id))) return `<b>ヒカリ石</b>が ${where}に あらわれた！`;
    }
    const dPlaza = Math.hypot(b.x - PLAZA.x, b.z - PLAZA.z);
    if (dPlaza < 34) {
      if (!(s.revealed & 1)) return `スミそうじ <b>${Math.floor(this.cur.area.goop.progress * 100)}%</b>`;
      if (!(s.revealed & 16)) return `スミボウ あと <b>${this.cur.enemies.alive}</b> ひき`;
    }
    if (!(s.gems & 2) && Math.hypot(b.x - HILL.x, b.z - HILL.z) < 46) return '<b>灯台</b>のてっぺんをめざそう';
    if (!(s.gems & 8) && b.x > 140) return '浮きブロックをわたって <b>岩のてっぺん</b>へ';
    const portals = this.town.portals;
    const gooped = portals?.gooped;
    if (gooped) return `<b>${LANDMARK[gooped.area as StageKey]}</b>のスミのかたまりを 洗い流そう`;
    for (const p of portals?.nextOpen ?? []) {
      const todo = STAGE_INFO[p.area as StageKey].missions.some((m) => !(s.gems & (1 << m.gem)));
      if (todo) return `${LANDMARK[p.area as StageKey]}のしるしに飛びこんで <b>${p.label}</b>へ`;
    }
    for (const m of this.cur.area.missions) if (!(s.gems & (1 << m.gem))) return m.hint;
    return '';
  }

  private checkObjectives(): void {
    const { area, items, enemies } = this.cur;
    for (const m of area.missions) {
      if (m.kind === 'reach' || this.isRevealed(m.gem)) continue;
      let done = false;
      if (m.kind === 'clean') done = area.goop.initial > 0 && area.goop.progress >= 0.97;
      else if (m.kind === 'defeat') done = enemies.list.length > 0 && enemies.alive === 0;
      else if (m.kind === 'collect') done = area.starfish.length > 0 && items.starCount >= area.starfish.length;
      if (done) {
        if (m.kind === 'clean') area.goop.clearAll();
        this.reveal(m.gem);
        return;
      }
    }
  }

  private reveal(id: number): void {
    if (this.stage) this.stage.revealed = true;
    else this.save.revealed |= 1 << id;
    this.cur.items.reveal(id);
    this.audio.reveal();
    this.hud.toast((!this.stage && REVEAL_TEXT[id]) || 'ヒカリ石が あらわれた！', 4);
    this.markDirty();
    this.cut = { kind: 'reveal', id, t: 0, dur: 2.6, angle: this.cam.yaw };
    this.mode = 'cutscene';
    this.player.frozen = true;
  }

  private collectGem(id: number): void {
    const first = (this.save.gems & (1 << id)) === 0;
    this.save.gems |= 1 << id;
    this.audio.gem();
    this.markDirty();
    const n = bitCount(this.save.gems);
    const m = this.cur.area.missions.find((x) => x.gem === id);
    $('gemSub').textContent = `${m?.title ?? ''}　${n}/${GEM_COUNT}${first ? '' : '（取得ずみ）'}`;
    $('gemGet').classList.remove('hidden');
    const cleared = first && this.save.gems === ALL_GEMS;
    const newBest = cleared && this.recordClearTime();
    this.cut = { kind: 'gem', id, t: 0, dur: 3.4, angle: this.player.yaw + 0.5, newBest };
    this.mode = 'cutscene';
    this.player.frozen = true;
    this.player.invuln = 0;
    this.flushSave(cleared);
  }

  private recordClearTime(): boolean {
    const time = Math.max(1, Math.round(this.save.playMs));
    if (this.save.bestMs !== null && this.save.bestMs <= time) return false;
    this.save.bestMs = time;
    this.markDirty();
    return true;
  }

  private endCutscene(): void {
    const cut = this.cut!;
    this.cut = null;
    this.player.frozen = false;
    $('gemGet').classList.add('hidden');
    this.cam.snap(this.player.body.x, this.player.body.y, this.player.body.z, this.cam.yaw);
    if (cut.kind === 'gem') {
      const all = this.save.gems === ALL_GEMS;
      if (this.stage) {
        // ステージのヒカリ石を取ったら町へ戻る
        this.mode = 'playing';
        this.enterArea('town', 0, all ? () => this.finishGame(cut.newBest === true) : undefined);
        return;
      }
      if (all) { this.finishGame(cut.newBest === true); return; }
      // 町でヒカリ石が増えたら、あたらしい異変が起きるか確かめる
      const appeared = this.town.portals?.sync(bitCount(this.save.gems), this.save.portals) ?? [];
      if (appeared.length) { this.announcePortal(appeared[0]); return; }
    }
    if (cut.kind === 'faint') {
      const sp = this.cur.area.spawn;
      this.player.teleport(sp.x, sp.y, sp.z, this.cur.area.spawnYaw);
      this.player.hp = this.player.maxHp;
      this.player.tank = this.player.tankMax;
      this.player.invuln = 2;
      this.cam.snap(sp.x, sp.y, sp.z, this.cur.area.spawnYaw + Math.PI);
      $('fade').classList.remove('on');
    }
    this.mode = 'playing';
  }

  private finishGame(newBest: boolean): void {
    const s = this.save;
    const time = Math.round(s.playMs);
    this.mode = 'ending';
    this.input.enabled = false;
    this.hud.show(false);
    if (document.pointerLockElement) document.exitPointerLock();
    $('endTime').textContent = formatTime(time);
    $('endBest').textContent = formatTime(s.bestMs ?? time);
    $('endShells').textContent = String(s.shells.length);
    $('endStars').textContent = `${this.town.items.starCount}/8`;
    const canRank = this.callbacks.canRank();
    const rankNote = this.user ? 'クラウドに同期すると、ランキングに記録が載ります。' : 'Googleでログインすると、記録をランキングに登録できます。';
    $('endNote').textContent = (newBest ? 'ベストタイム更新！ ' : '') + (canRank ? rankNote : '');
    $('btnEndRank').classList.toggle('hidden', !canRank);
    $('ending').classList.remove('hidden');
    $('btnEndContinue').focus();
  }

  // ───────────────────────── メインループ ─────────────────────────
  private readonly tick = (now: number): void => {
    this.frameId = null;
    if (this.mode === 'idle') return;
    const session = this.session;
    try {
      this.frame(now);
      if (session === this.session) this.frameId = requestAnimationFrame(this.tick);
    } catch (error) {
      this.fail(error);
    }
  };

  private fail(error: unknown): void {
    console.error(error);
    this.leaveAdventure();
    this.callbacks.onError?.(error);
  }

  private frame(now: number): void {
    if (this.mode === 'idle') return;
    const rawDt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (rawDt <= 0) return;
    const { input, player, gfx, particles, hud } = this;
    const { area, items, enemies, npcs, portals } = this.cur;
    input.poll();
    if (this.callbacks.panels.isOpen) return;
    if (input.jumpPressed) this.pendingJump = true;
    const simulating = (this.mode === 'playing' || this.mode === 'cutscene') && !this.switching;
    const dt = this.mode === 'paused' || this.mode === 'select' || this.switching ? 0 : rawDt;
    this.time += dt;
    const t = this.time;

    if (this.mode === 'playing' && input.pausePressed) this.pause();
    else if (this.mode === 'paused' && input.pausePressed) this.resume();
    else if (this.mode === 'select' && input.pausePressed) this.cancelEpisodes();
    else if (this.mode === 'select' && this.pendingJump && this.selecting) {
      // キーボードの Space やパッドの A でも決定できる（まだ取っていない最初のステージを選ぶ）
      this.pendingJump = false;
      const ms = STAGE_INFO[this.selecting].missions;
      const next = ms.findIndex((m, i) => !(this.save.gems & (1 << m.gem)) && (i === 0 || (this.save.gems & (1 << ms[i - 1].gem)) !== 0));
      this.chooseEpisode(next < 0 ? 0 : next);
    }

    if (simulating) {
      // 物理は最大 1/120 秒刻みに分割して安定させる
      const n = Math.min(8, Math.max(1, Math.ceil(dt * 120)));
      const h = dt / n;
      const playing = this.mode === 'playing';
      for (let i = 0; i < n; i++) {
        area.stepMovers(t - dt + h * (i + 1));
        player.step(h, {
          mx: playing ? input.moveX : 0,
          my: playing ? input.moveY : 0,
          jump: playing && input.jump,
          jumpPressed: playing && this.pendingJump,
          spray: playing && input.spray,
          hover: playing && input.hover,
        }, this.cam.yaw);
        this.pendingJump = false;
      }
      enemies.update(dt, t, player, playing);
      area.tick(t, dt, particles, playing ? player : null);
      particles.update(dt, area.goop, area.colliders);
      const b = player.body;
      items.update(dt, t, b.x, b.y, b.z, playing, gfx.camera.position);
      const speech = npcs.update(dt, t, b.x, b.y, b.z, gfx.camera.position);
      const entered = portals ? portals.update(dt, t, b.x, b.y, b.z, playing) : null;

      if (playing) {
        if (this.save.gems !== ALL_GEMS) this.save.playMs += dt * 1000;
        this.cam.update(dt, b.x, b.y, b.z, b.vx, b.vz, input.lookX, input.lookY, input.zoom, input.device !== 'keyboard');
        player.aimPitch = clamp(0.2 - (this.cam.pitch - 0.3) * 0.95, -0.55, 0.85);
        if (this.mode === 'playing') this.checkObjectives();
        if (entered && this.mode === 'playing') this.openEpisodes(entered.area as StageKey);
        if (player.hp <= 0 && !this.cut && this.mode === 'playing') {
          this.cut = { kind: 'faint', id: 0, t: 0, dur: 1.5, angle: 0 };
          this.mode = 'cutscene';
          player.frozen = true;
          hud.toast(this.stage ? 'やられちゃった… ステージの最初から！' : 'やられちゃった… 広場からやりなおし！', 2.5);
          const fade = $('fade');
          fade.classList.add('dark');
          const faint = this.cut;
          window.setTimeout(() => { if (this.cut === faint) fade.classList.add('on'); }, 700);
        }
      } else if (this.cut) {
        const c = this.cut;
        c.t += dt;
        if (c.kind === 'gem') {
          c.angle += dt * 0.9;
          this.cam.orbit(b.x, b.y + 1.0, b.z, 5.2, 1.6, c.angle);
          if (Math.random() < dt * 30) particles.spawn(4, b.x + (Math.random() - 0.5) * 2, b.y + Math.random() * 2.4, b.z + (Math.random() - 0.5) * 2, 0, 1.5, 0, 0.9, 0.24);
        } else if (c.kind === 'reveal') {
          const g = items.gemPosition(c.id);
          c.angle += dt * 0.5;
          this.cam.orbit(g.x, g.y, g.z, 9, 3.2, c.angle);
        } else if (c.kind === 'look' && c.at) {
          c.angle += dt * 0.25;
          this.cam.orbit(c.at.x, c.at.y + 0.5, c.at.z, 12, 3.5, c.angle);
        } else {
          this.cam.update(dt, b.x, b.y, b.z, 0, 0, 0, 0, 0, false);
        }
        if (c.t >= c.dur) this.endCutscene();
      }

      // HUD
      this.comboT -= dt;
      this.cleanSoundT -= dt;
      hud.setHearts(player.hp, player.maxHp);
      hud.setGems(bitCount(this.save.gems));
      hud.setCounts(this.save.shells.length + this.pendingShells(), items.starCount, area.starfish.length);
      hud.setTank(player.tank / player.tankMax, player.hoverLeft, player.hovering);
      hud.setTimer(this.save.playMs, this.save.gems !== ALL_GEMS);
      hud.setObjective(playing && !speech ? this.currentObjective() : '');
      hud.setBubble(speech && playing ? speech.name : null, speech?.text ?? '', speech?.pos ?? null, gfx.camera);
      if (this.hintT > 0) {
        this.hintT -= dt;
        hud.setHint(this.hintT > 0 ? (input.device === 'gamepad' ? '左スティック: いどう　A: ジャンプ（空中で長押し＝ホバー）　RT: 水をかける' : 'WASD: いどう　Space: ジャンプ（空中で長押し＝ホバー）　クリック: 水をかける') : null);
      }
      this.audio.setContinuous(player.spraying, player.hovering, player.hoverLeft);
      player.animate(dt, t, this.cut?.kind === 'gem');
      gfx.followShadow(this.tmp.set(b.x, b.y, b.z), SUN_DIR);

      if (this.saveDirty && (this.saveTimer += dt) > 2) { this.saveTimer = 0; this.flushSave(false); }
    } else if (this.mode === 'ending') {
      // 町をゆっくり見わたす
      const a = t * 0.06 + 0.6;
      this.cam.orbit(PLAZA.x, 9, PLAZA.z, 78 + Math.sin(t * 0.11) * 10, 30 + Math.sin(t * 0.07) * 6, a);
      items.update(dt, t, 0, -100, 0, false, gfx.camera.position);
      npcs.update(dt, t, 0, -100, 0, gfx.camera.position);
      enemies.update(dt, t, player, false);
      portals?.update(dt, t, 0, -100, 0, false);
      area.tick(t, dt, particles, null);
      particles.update(dt, area.goop, area.colliders);
      player.animate(dt, t);
      gfx.followShadow(this.tmp.set(PLAZA.x, PLAZA.y, PLAZA.z), SUN_DIR);
    }

    for (const u of this.timeUniforms) u.value = t;
    area.update(t);
    area.goop.flush();
    const size = gfx.renderer.getDrawingBufferSize(_size);
    particles.sync(size.y / (2 * Math.tan((gfx.camera.fov * Math.PI) / 360)));
    this.terrain.updateDetail(gfx.camera.position);
    area.updateVegetation(gfx.camera.position, gfx.tier !== 'low');
    gfx.render(rawDt, this.mode === 'playing');

    if (this.settings.showFps) {
      const st = gfx.stats, info = gfx.renderer.info.render;
      hud.setFps(`${st.fps.toFixed(0)} fps\n${st.width}×${st.height}  品質:${st.tier}\n${info.calls} draws  ${(info.triangles / 1000).toFixed(0)}k tris`);
    } else hud.setFps(null);
  }

  /** まだセーブに書いていない、このエリアで取ったばかりの貝がらの数 */
  private pendingShells(): number {
    const { area, items } = this.cur;
    const lo = area.shellBase, hi = lo + area.shells.length;
    let saved = 0;
    for (const i of this.save.shells) if (i >= lo && i < hi) saved++;
    return items.shellCount - saved;
  }

  /** テスト・デバッグ用に内部を公開する（?debug のときだけ） */
  expose(): void {
    (window as unknown as Record<string, unknown>).__splash = this;
  }
}

const _size = new THREE.Vector2();
