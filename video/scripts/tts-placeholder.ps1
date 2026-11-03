# 仮の声を作る（作者の声を録るまでの代わり。T43）。Windows の読み上げ（System.Speech、ja-JP の声）で 1 文 1 WAV。
# 鍵もネットも要らない。作る物は video/assets/voice-tts/N01.wav …（commit しない。.gitignore）。
#
# 使い方（video/ の中で、Windows PowerShell 5.1 か PowerShell 7）:
#   powershell -ExecutionPolicy Bypass -File scripts/tts-placeholder.ps1            全部の文
#   powershell -ExecutionPolicy Bypass -File scripts/tts-placeholder.ps1 -Only N05  1 文だけ作り直す
#   そのあと npm run scan（作者の声 video/assets/voice/N01.wav があれば、そちらが先に使われる）
#
# - 文は docs/video/SCRIPT.md の台本の表（| N01 | 0:00.5–0:06.5 | 日本語 | 英語 |）から読む。台本が正
# - ［ ］のある文（埋める所が残る文）は作らない（測っていない数字を声にしない）
# - 読ませる文だけ、SCRIPT.md の「読み」に合わせて言い換える（台本の字は変えない）
# - 速さ: 0 で読んで秒の枠（終わり − 始まり − 0.15 秒）からはみ出たら、枠に入るまで 1 段ずつ速くする（+5 まで）。
#   +5 でもはみ出る文は「はみ出し」と出す（書き出しで切れる。台本の文を削る候補）
# - 声は Microsoft Haruka（ja-JP）。無ければ ja-JP のほかの声、それも無ければ入っている声のどれか
# - このファイルは UTF-8（BOM つき）。Windows PowerShell 5.1 が日本語を読み違えないため
param(
  [string]$Only = "",
  [string]$Voice = "Microsoft Haruka Desktop"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path (Split-Path -Parent $root) "docs/video/SCRIPT.md"
$outDir = Join-Path $root "assets/voice-tts"
New-Item -ItemType Directory -Force $outDir | Out-Null

# 読み（SCRIPT.md の「読み」）。上から順に置き換える（長い語を先に）
$readings = [ordered]@{
  "Claude Code"  = "クロードコード"
  "Claude Haiku" = "クロード ハイク"
  "Claude"       = "クロード"
  "Opus"         = "オーパス"
  "Haiku"        = "ハイク"
  "MCP"          = "エムシーピー"
  "AI"           = "エーアイ"
  "ケア72"       = "ケア ななじゅうに"
  "72 時間"      = "ななじゅうに時間"
  "15.1%"        = "じゅうごてんいちパーセント"
  "527 人"       = "ごひゃくにじゅうななにん"
  "10 人"        = "じゅうにん"
  "84 歳"        = "はちじゅうよんさい"
  "1 体ずつ"     = "いったいずつ"
  "1 枚"         = "いちまい"
  "2 つ"         = "ふたつ"
  "山田ハナ"     = "やまだハナ"
  "能登"         = "のと"
  "輪島"         = "わじま"
  "出向く"       = "でむく"
}

function Seconds([string]$s) {
  $m = [regex]::Match($s.Trim(), '^(\d+):(\d+(?:\.\d+)?)$')
  if (-not $m.Success) { throw "秒が読めない: $s" }
  return [double]$m.Groups[1].Value * 60 + [double]$m.Groups[2].Value
}

function WavSeconds([string]$path) {
  # 48kHz・16bit・mono で書くので、頭の 44 バイトを除いた大きさから秒を出す
  $len = (Get-Item $path).Length
  return ($len - 44) / (48000 * 2)
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo }
$pick = $voices | Where-Object { $_.Name -eq $Voice } | Select-Object -First 1
if (-not $pick) { $pick = $voices | Where-Object { $_.Culture.Name -eq "ja-JP" } | Select-Object -First 1 }
if (-not $pick) { $pick = $voices | Select-Object -First 1 }
if (-not $pick) { throw "読み上げの声が入っていない" }
$synth.SelectVoice($pick.Name)
Write-Output "声: $($pick.Name)（$($pick.Culture.Name)）"
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

$rows = Get-Content -Encoding UTF8 $script | Where-Object { $_ -match '^\| N\d{2} \|' }
$made = 0
$report = @()
foreach ($row in $rows) {
  $cells = @($row.Split("|") | ForEach-Object { $_.Trim() })
  # 先頭と末尾の空を除くと ID・秒・日本語・英語の 4 つ。ほかの表（埋める所・出典）の N の行は飛ばす
  if ($cells.Count -ne 6 -or $cells[2] -notmatch '^\d+:\d') { continue }
  $id = $cells[1]; $time = $cells[2]; $ja = $cells[3]
  if ($Only -and $id -ne $Only) { continue }
  $wav = Join-Path $outDir "$id.wav"
  if ($ja.Contains("［")) {
    Remove-Item -Force -ErrorAction SilentlyContinue $wav
    $report += "$id 作らない（埋める所が残る）"
    continue
  }
  $parts = $time.Split([char]0x2013)
  $slot = (Seconds $parts[1]) - (Seconds $parts[0]) - 0.15
  $say = $ja
  foreach ($k in $readings.Keys) { $say = $say.Replace($k, $readings[$k]) }
  $rate = 0
  while ($true) {
    $synth.Rate = $rate
    $synth.SetOutputToWaveFile($wav, $format)
    $synth.Speak($say)
    $synth.SetOutputToNull()
    $sec = WavSeconds $wav
    if ($sec -le $slot -or $rate -ge 5) { break }
    $rate++
  }
  $note = if ($sec -gt $slot) { " はみ出し" } else { "" }
  $report += ("{0} 速さ {1,2} 声 {2,4:N1} 秒 / 枠 {3,4:N1} 秒{4}" -f $id, $rate, $sec, $slot, $note)
  $made++
}
$synth.Dispose()
$report | ForEach-Object { Write-Output $_ }
Write-Output "作った: $made 文 → $outDir"
