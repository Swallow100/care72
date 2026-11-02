// Remotion の設定。書き出しの形は README の「書き出し」。
// 1920×1080・30fps・長さは src/Root.tsx の Composition に書く。
import { Config } from "@remotion/cli/config";

// 静止画の連番を読むので、各コマは jpeg で十分（png より速い）
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
// 書き出しの映像は h264。字幕の細い線がつぶれないよう crf は低め
Config.setCodec("h264");
Config.setCrf(16);
// 前の書き出しを上書きする
Config.setOverwriteOutput(true);
