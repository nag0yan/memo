output "aws_region" {
  description = "AWS Region used by the application."
  value       = data.aws_region.current.region
}

output "cognito_user_pool_id" {
  description = "Cognito user pool ID."
  value       = aws_cognito_user_pool.memo.id
}

output "cognito_user_pool_client_id" {
  description = "Cognito app client ID."
  value       = aws_cognito_user_pool_client.memo.id
}

output "dsql_endpoint" {
  description = "Aurora DSQL cluster endpoint."
  value       = "${aws_dsql_cluster.memo.identifier}.dsql.${data.aws_region.current.region}.on.aws"
}

output "web_function_name" {
  description = "Lambda Web Function name."
  value       = aws_lambdaweb_function.memo.function_name
}

output "web_function_role_arn" {
  description = "Execution role ARN for the Lambda Web Function."
  value       = aws_iam_role.web_function.arn
}

output "web_function_url" {
  description = "HTTPS URL of the Lambda Web Function endpoint."
  value       = "https://${aws_lambdaweb_function_endpoint.memo.domain_name}"
}
