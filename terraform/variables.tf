variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "project" {
  type    = string
  default = "ssit-crm"
}

# Web/worker box. t4g.medium = 2 vCPU / 4 GB ARM (Graviton) — cheap + ample
# headroom for Next.js + worker + redis + caddy on one host.
variable "instance_type" {
  type    = string
  default = "t4g.medium"
}

variable "root_volume_gb" {
  type    = number
  default = 40
}

# Managed Postgres. db.t4g.micro is free-tier-eligible for the first 12 months
# on a new account, then ~₹1k/mo. Bump to db.t4g.small when you outgrow it.
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

# Storage AUTOSCALING ceiling. RDS grows allocated storage on demand up to this
# (never shrinks) so a full disk can't fail writes / lose data — and you only
# pay for what's actually used, not the ceiling. Set comfortably above the
# baseline. 0/equal-to-allocated disables autoscaling.
variable "db_max_allocated_storage" {
  type    = number
  default = 200
}

# Monthly cost guardrail. AWS Budgets emails at 80% (actual) and 100%
# (forecast) so spend never surprises you. Budgets themselves are free.
variable "monthly_budget_usd" {
  type    = string
  default = "60"
}

# Where budget alerts go. Blank (the default) SKIPS the budget entirely.
# IMPORTANT on a SHARED AWS account: an AWS Budget is ACCOUNT-WIDE, not
# per-project — it would measure this stack PLUS every other project in the
# account and fire misleading alerts. Only set this if the limit above is sized
# for the whole account's spend, or if this stack has its own AWS account.
variable "budget_alert_email" {
  type    = string
  default = ""
}

variable "db_name" {
  type    = string
  default = "ssit_crm"
}

variable "db_username" {
  type    = string
  default = "ssit_master"
}

# Only this CIDR may SSH to the box. Set to <your-public-ip>/32 in tfvars.
variable "ssh_cidr" {
  type        = string
  description = "CIDR allowed to SSH (e.g. 49.36.117.249/32)"
}

variable "public_key_path" {
  type    = string
  default = "~/.ssh/ssit-crm-deploy.pub"
}
