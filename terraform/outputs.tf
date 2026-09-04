output "public_ip" {
  description = "Elastic IP — point your domain's A record here."
  value       = aws_eip.web.public_ip
}

output "ssh_command" {
  description = "SSH into the box."
  value       = "ssh -i ~/.ssh/ssit-crm-deploy ec2-user@${aws_eip.web.public_ip}"
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}

output "db_port" {
  value = aws_db_instance.main.port
}

output "s3_bucket" {
  value = aws_s3_bucket.uploads.bucket
}

# Read with: terraform output -raw database_url  (kept out of logs)
output "database_url" {
  sensitive = true
  value     = "postgresql://${var.db_username}:${random_password.db.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.db_name}"
}
