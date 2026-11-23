-- 既存のファイルを最初の版とする。空きファイルの revision 0 は行を作らずに表す。
ALTER TABLE saves ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE save_slots ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
