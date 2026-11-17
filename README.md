# Memo

個人用メモのMVPです。AWS Lambda Web Functions（Node.js 24）、Amazon Cognito User Pools、Aurora DSQLを使用します。ユーザーはCognito管理者が作成し、アプリからの自己登録はできません。

## 構成

- Lambda Web Functionが静的UIとJSON APIを同じHTTPSエンドポイントで提供します。API GatewayやLambda Web Adapterは使いません。
- TerraformがWeb Function、revision、endpoint、およびバージョニングされたS3デプロイパッケージを管理します。新しいrevisionが作成されると、endpointを新revisionに切り替えてから旧revisionを削除します。
- Cognitoのユーザー名はメールアドレスです。初回ログイン時の仮パスワード変更にも対応しています。
- Aurora DSQLへの接続はAWS公式Node.jsコネクターとIAM認証を使用します。Web Functionの実行ロールは`dsql:DbConnect`のみを持ち、DBの`memo_app`ロールに対応付けます。
- メモの所有者IDは検証済みCognitoアクセストークンの`sub`です。DB操作は常に所有者IDで絞り込みます。

## デプロイ

事前にmise、Node.js 24以降、pnpmを用意し、東京リージョンのAWS認証情報を設定してください。リポジトリのmise設定にTerraform 1.17.0とpnpm 12.16.1を固定しています。Terraform実行ユーザーにはCognito、Aurora DSQL、IAM、CloudWatch Logs、S3およびLambda Web Functionsの管理権限、`iam:PassRole`、Cloud Control APIの権限が必要です。Web Functionの作成には`cloudformation:CreateResource`も必要です。

```sh
mise exec -- terraform -chdir=terraform init
mise run deploy
```

デプロイタスクは本番依存パッケージをインストールし、Terraformを実行します。TerraformはアプリをZIP化してS3に保存します。更新時も同じタスクを実行してください。`mise run deploy -auto-approve`のように、引数は`terraform apply`に渡せます。URLは`terraform -chdir=terraform output -raw web_function_url`で確認できます。

DB初期化は最初のデプロイ後に、Aurora DSQLの`dsql:DbConnectAdmin`権限を持つAWS認証情報で一度実行します。スクリプトは`memo_app` DBロール、IAMマッピング、メモテーブルを作成します。初期化が完了するまではメモ操作は失敗します。

```sh
export AWS_REGION="$(terraform -chdir=terraform output -raw aws_region)"
export DSQL_ENDPOINT="$(terraform -chdir=terraform output -raw dsql_endpoint)"
export WEB_FUNCTION_ROLE_ARN="$(terraform -chdir=terraform output -raw web_function_role_arn)"
mise exec -- pnpm --dir app install
mise exec -- pnpm --dir app run db:migrate
```

ユーザーはCognitoコンソールの対象User Poolで**ユーザーを作成**してください。アプリからの新規登録は許可されていません。管理者が設定した仮パスワードで初回ログインすると、アプリ上で新しいパスワードを設定できます。

以前の`aws lambda-web deploy`で同名のWeb Functionや`dev` endpointを作成済みの場合は、Terraformでのimportまたは移行が必要です。そのまま適用するとリソース名が衝突します。

## ローカル開発とテスト

`app`ディレクトリで依存パッケージをインストールし、必要な環境変数とAWS認証情報を設定して起動します。DSQLには`memo_app`ロールとIAMマッピングが必要です。

```sh
mise exec -- pnpm --dir app install
COGNITO_USER_POOL_ID=... \
COGNITO_CLIENT_ID=... \
DSQL_ENDPOINT=... \
AWS_REGION=ap-northeast-1 \
mise exec -- pnpm --dir app start
```

テストはAWSリソースを必要としません。Terraformのテストでは、事前に本番依存パッケージをフラットにインストールしておきます。

```sh
mise exec -- pnpm --dir app test
terraform -chdir=terraform fmt -check -recursive
terraform -chdir=terraform validate
mise exec -- pnpm --dir app install --prod --frozen-lockfile --node-linker=hoisted
terraform -chdir=terraform test
```

## 削除

`terraform -chdir=terraform destroy`でWeb Functionを含むTerraform管理リソースを削除できます。DB内のメモ、Cognitoユーザー、S3内のデプロイパッケージの全バージョンも削除されるため、必要なデータを事前に退避してください。

## 参考資料

- [AWS Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)
- [Lambda Web Functionの作成とデプロイ](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-create.html)
- [Aurora DSQL向けNode.jsコネクター](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_Node-js-connectors.html)
- [Aurora DSQLのIAMとDBロール](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/using-database-and-iam-roles.html)
- [CognitoのサードパーティIdP連携](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-identity-federation.html)
