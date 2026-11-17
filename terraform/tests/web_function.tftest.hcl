mock_provider "aws" {
  mock_data "aws_region" {
    defaults = {
      region = "ap-northeast-1"
    }
  }

  mock_resource "aws_s3_object" {
    defaults = {
      version_id = "package-version"
    }
  }

  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/memo-app-web-function"
    }
  }

  mock_resource "aws_lambdaweb_function_revision" {
    defaults = {
      revision_id = "revision-id"
    }
  }
}

run "web_function_uses_versioned_package" {
  command = apply

  assert {
    condition     = aws_s3_bucket_versioning.web_function_code.versioning_configuration[0].status == "Enabled"
    error_message = "The deployment bucket must have versioning enabled."
  }

  assert {
    condition     = aws_lambdaweb_function_revision.memo.build_config[0].code_config[0].s3_object[0].version_id == aws_s3_object.web_function_code.version_id
    error_message = "The revision must use the uploaded object version."
  }

  assert {
    condition = (
      aws_lambdaweb_function_endpoint.memo.auto_deployment_mode == "Disabled" &&
      one(aws_lambdaweb_function_endpoint.memo.revision_weight).revision_id == aws_lambdaweb_function_revision.memo.revision_id &&
      one(aws_lambdaweb_function_endpoint.memo.revision_weight).weight == 100
    )
    error_message = "The endpoint must route all traffic to the managed revision."
  }

  assert {
    condition = (
      aws_lambdaweb_function_revision.memo.service_config[0].environment_variables["COGNITO_USER_POOL_ID"] == aws_cognito_user_pool.memo.id &&
      aws_lambdaweb_function_revision.memo.service_config[0].environment_variables["COGNITO_CLIENT_ID"] == aws_cognito_user_pool_client.memo.id &&
      aws_lambdaweb_function_revision.memo.service_config[0].environment_variables["NODE_ENV"] == "production"
    )
    error_message = "The revision must receive the application configuration."
  }
}
