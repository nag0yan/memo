data "aws_region" "current" {}

locals {
  web_function_name = var.project_name

  common_tags = {
    Project   = var.project_name
    ManagedBy = "Terraform"
  }
}

resource "aws_dsql_cluster" "memo" {
  tags = local.common_tags
}

resource "aws_cognito_user_pool" "memo" {
  name                = "${var.project_name}-users"
  username_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  tags = local.common_tags
}

resource "aws_cognito_user_pool_client" "memo" {
  name         = "${var.project_name}-web"
  user_pool_id = aws_cognito_user_pool.memo.id

  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_USER_PASSWORD_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  access_token_validity         = 60
  id_token_validity             = 60
  refresh_token_validity        = 1

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cloudwatch_log_group" "web_function" {
  name              = "/aws/lambda/web/${local.web_function_name}"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_iam_role" "web_function" {
  name = "${var.project_name}-web-function"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "web_function" {
  name = "${var.project_name}-runtime"
  role = aws_iam_role.web_function.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.web_function.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["dsql:DbConnect"]
        Resource = aws_dsql_cluster.memo.arn
      }
    ]
  })
}

data "archive_file" "web_function" {
  type             = "zip"
  source_dir       = "${path.module}/../app"
  output_path      = "${path.module}/.terraform/memo-web.zip"
  output_file_mode = "0644"
  excludes = [
    "test",
    "scripts",
    "pnpm-lock.yaml",
    "node_modules/.modules.yaml",
    "node_modules/.pnpm-workspace-state-v1.json",
    "node_modules/.pnpm/**",
  ]

  lifecycle {
    precondition {
      condition = try(
        fileexists("${path.module}/../app/node_modules/express/package.json") &&
        yamldecode(file("${path.module}/../app/node_modules/.modules.yaml")).nodeLinker == "hoisted" &&
        !yamldecode(file("${path.module}/../app/node_modules/.modules.yaml")).included.devDependencies,
        false
      )
      error_message = "Install production dependencies using mise run deploy before running Terraform."
    }
  }
}

resource "aws_s3_bucket" "web_function_code" {
  bucket_prefix = "memo-web-code-"
  force_destroy = true
  tags          = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "web_function_code" {
  bucket                  = aws_s3_bucket.web_function_code.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "web_function_code" {
  bucket = aws_s3_bucket.web_function_code.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_policy" "web_function_code" {
  bucket = aws_s3_bucket.web_function_code.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowLambdaWebFunctionCodeAccess"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = ["s3:GetObject", "s3:GetObjectVersion"]
      Resource  = "${aws_s3_bucket.web_function_code.arn}/web-function/*"
      Condition = {
        ArnLike = {
          "aws:SourceArn" = "${aws_lambdaweb_function.memo.arn}/revision/*"
        }
      }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.web_function_code]
}

resource "aws_s3_object" "web_function_code" {
  bucket      = aws_s3_bucket.web_function_code.id
  key         = "web-function/memo.zip"
  source      = data.archive_file.web_function.output_path
  source_hash = data.archive_file.web_function.output_sha256

  depends_on = [aws_s3_bucket_versioning.web_function_code]
}

resource "aws_lambdaweb_function" "memo" {
  function_name = local.web_function_name
  tags          = local.common_tags
}

resource "aws_lambdaweb_function_revision" "memo" {
  function_name = aws_lambdaweb_function.memo.function_name

  build_config {
    runtime_config {
      runtime = "nodejs24.x"
    }

    code_config {
      s3_object {
        bucket     = aws_s3_bucket.web_function_code.id
        key        = aws_s3_object.web_function_code.key
        version_id = aws_s3_object.web_function_code.version_id
      }
    }
  }

  service_config {
    execution_role_arn              = aws_iam_role.web_function.arn
    timeout_seconds                 = 30
    max_concurrency_per_environment = 32
    environment_variables = {
      COGNITO_USER_POOL_ID = aws_cognito_user_pool.memo.id
      COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.memo.id
      DSQL_ENDPOINT        = "${aws_dsql_cluster.memo.identifier}.dsql.${data.aws_region.current.region}.on.aws"
      NODE_ENV             = "production"
    }
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_iam_role_policy.web_function,
    aws_s3_bucket_policy.web_function_code,
  ]
}

resource "aws_lambdaweb_function_endpoint" "memo" {
  function_name        = aws_lambdaweb_function.memo.function_name
  endpoint_name        = "dev"
  endpoint_type        = "HomeRegion"
  auth_type            = "ApplicationManaged"
  auto_deployment_mode = "Disabled"

  revision_weight {
    revision_id = aws_lambdaweb_function_revision.memo.revision_id
    weight      = 100
  }
}