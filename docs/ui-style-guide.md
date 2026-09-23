# まちつなマップ UIコンポーネント・スタイルガイド

## 目的

「まちつなマップ」の全画面で、ボタン・入力欄・文字・アイコンの見た目と操作感を統一する。
Material Design 3 の考え方を参考に、明確な階層、十分なタッチ領域、フォーカス状態、状態変化、再利用できるデザイントークンを基本方針とする。

参考：
- Material Design 3 Buttons: https://m3.material.io/components/buttons/overview
- Material Design 3 Typography: https://m3.material.io/styles/typography/overview
- Material Design 3 Icons: https://m3.material.io/styles/icons/overview

## 1. デザイン原則

### 地域らしさと一貫性
ブランドカラーは地域・自然を表すグリーンを主軸に、アクセントとしてオレンジを使用する。
テーマショップの色は残しつつ、コンポーネントの形・余白・文字階層は共通化する。

### 明確な情報階層
主要操作は塗りつぶしボタン、補助操作はアウトラインまたはトーナルなボタン、危険操作は赤系として役割を区別する。

### 操作しやすさ
通常のボタンは40〜44px程度を基準とし、タッチ操作が中心の環境では48px以上を確保する。
アイコンだけの操作にも十分なクリック領域を設ける。

### 状態を明示
hover、focus-visible、disabled、active を同じルールで表現する。
キーボード操作時には視認できるフォーカスリングを表示する。

## 2. タイポグラフィ

基本フォント：system-ui, -apple-system, "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif

階層：
- Display：アプリ名など最重要タイトル
- Headline：画面タイトル、主要見出し
- Title：カード・パネル見出し
- Body：投稿本文、説明文
- Label：ボタン、タグ、補助情報

投稿本文は14px前後、補助情報は10〜12pxを基本とし、読みやすさを優先する。

## 3. ボタン

### Primary
画面の主要アクション。
例：チャット参加、送信、テーマ適用。

### Secondary / Tonal
補助的な操作。
例：通知、表示切替、返信、リアクション。

### Destructive
削除・拒否など、取り消しに注意が必要な操作。
赤系で意味を明確にする。

共通ルール：
- font-weight: 700 前後
- border-radius: 10〜12px
- min-height: 40〜44px
- アイコンと文字は中央揃え
- disabled は透明度を下げ、操作不可を明示
- focus-visible は2〜3pxのアウトライン

## 4. アイコン

アイコンは「操作の意味を補助する」目的で使用し、文字だけでも意味が伝わるラベルを優先する。
アイコン単独ボタンは aria-label / title を付ける。
アイコンと文字の間隔は4〜8px、通常サイズは18〜20pxを基準とする。

現在の絵文字アイコンは既存機能との互換性を保ちながら、ボタン内のサイズ・配置・余白を共通化する。

## 5. 入力コンポーネント

入力欄は角丸10〜12px、十分な上下パディング、明確なfocus状態を使用する。
placeholder は本文より弱い色にし、入力中の文字とのコントラストを確保する。

## 6. カード・投稿

親投稿と返信投稿は背景・境界線・左アクセント線で区別する。
カードの角丸、内側余白、本文行間は全画面で共通化する。

## 7. レスポンシブ

PCでは情報密度を維持し、モバイルでは操作対象を大きくする。
タッチ端末では主要操作の最小タップ領域を48pxを目安にする。

## 8. 実装トークン

CSS変数で以下を共有する。

- --ui-font-family
- --ui-radius-sm / md / lg
- --ui-space-*
- --ui-control-height
- --ui-touch-target
- --ui-focus-ring
- --ui-elevation-*

今後コンポーネントを追加するときは、ページ固有の色・角丸・余白を新規定義せず、まず共通トークンを使用する。