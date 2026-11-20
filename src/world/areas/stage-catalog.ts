import type { AreaKey, MissionDef } from '../area';

export type StageKey = Exclude<AreaKey, 'town'>;

export const VOLCANO_MISSIONS: MissionDef[] = [
  { gem: 5, kind: 'reach', title: '火口のまんなかへ', hint: '間欠泉で段をのぼり <b>火口の岩</b>をめざそう' },
  { gem: 6, kind: 'clean', title: '温泉街のスミを洗い流そう', hint: '温泉街の<b>スミ</b>を洗い流そう' },
  { gem: 7, kind: 'collect', title: '山にちらばるヒトデを8つ', hint: '山じゅうの<b>ヒトデ</b>をさがそう' },
];

export const LAGOON_MISSIONS: MissionDef[] = [
  { gem: 8, kind: 'reach', title: '難破船のマストのてっぺんへ', hint: '難破船の <b>マストのてっぺん</b>をめざそう' },
  { gem: 9, kind: 'defeat', title: '入り江のスミボウたいじ', hint: '入り江の<b>スミボウ</b>をぜんぶやっつけよう' },
  { gem: 10, kind: 'collect', title: 'サンゴの上のヒトデを8つ', hint: '入り江の<b>ヒトデ</b>をさがそう' },
];

export const PLATEAU_MISSIONS: MissionDef[] = [
  { gem: 11, kind: 'reach', title: 'いちばん高い台地へ', hint: '吊り橋と気球をわたって <b>いちばん高い台地</b>へ' },
  { gem: 12, kind: 'clean', title: '台地の村のスミを洗い流そう', hint: '村の<b>スミ</b>を洗い流そう' },
  { gem: 13, kind: 'collect', title: '空にちらばるヒトデを8つ', hint: '台地じゅうの<b>ヒトデ</b>をさがそう' },
];

export const STAGE_INFO: Record<StageKey, { name: string; blurb: string; missions: MissionDef[] }> = {
  volcano: { name: 'ゆけむり山', blurb: '湯けむりの立つ温泉火山', missions: VOLCANO_MISSIONS },
  lagoon: { name: 'サンゴ入り江', blurb: '難破船のねむる環礁', missions: LAGOON_MISSIONS },
  plateau: { name: 'そよかぜ台地', blurb: '吊り橋と気球の空の村', missions: PLATEAU_MISSIONS },
};
