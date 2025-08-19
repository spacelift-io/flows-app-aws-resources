# AWS Resources App

Manage AWS infrastructure declaratively using AWS CloudControl API. This Flows app provides blocks for creating, updating, and managing AWS resources with automatic lifecycle management and intelligent update handling.

## Features

- **15+ Pre-built AWS Resource Blocks**: Common resources like S3 buckets, DynamoDB tables, SNS topics, SQS queues, VPCs, and more
- **Generic Resource Block**: Universal block that can manage any AWS resource supported by CloudControl API
- **Intelligent Updates**: Automatically handles read-only and create-only properties to prevent update conflicts
- **Schema-based Validation**: Dynamic resource validation based on CloudFormation schemas
- **Optimized Caching**: Efficient caching of resource schemas for improved performance

## Quick Start

1. **Configure AWS Credentials**:
   - `accessKeyId`: Your AWS access key
   - `secretAccessKey`: Your AWS secret key
   - `sessionToken`: Optional session token for temporary credentials

2. **Use Specific Resource Blocks**:
   - Choose from pre-built blocks like "S3 Bucket", "DynamoDB Table", "SNS Topic"
   - Each block provides typed configuration fields based on AWS CloudFormation schemas

3. **Use Generic Resource Block**:
   - For resources not available as specific blocks
   - Specify any CloudFormation resource type (e.g., `AWS::EC2::Instance`)
   - Provide desired state as a JSON object

## Supported Resources

**Specific Blocks**: CloudFormation Stack, DynamoDB Table, EC2 VPC, S3 Bucket & Policies, SNS Topics & Policies, SQS Queues & Policies, Secrets Manager Secret, SSM Parameter

**Generic Block**: Any AWS resource type supported by [AWS CloudControl API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html) - over 700+ resource types including EC2, RDS, Lambda, ECS, and more.

## How It Works

- **CloudControl Integration**: Uses AWS CloudControl API for consistent resource management across all AWS services
- **CloudFormation Schema Validation**: Automatically fetches and validates against official AWS resource schemas
- **Lifecycle Management**: Handles resource creation, updates, and cleanup with proper error handling and status tracking
- **Update Safety**: Prevents invalid updates by excluding read-only and create-only properties from patch operations
