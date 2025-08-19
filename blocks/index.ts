import { stack } from "./cloudformation/stack";
import { table } from "./dynamodb/table";
import { vpc } from "./ec2/vpc";
import { bucket } from "./s3/bucket";
import { bucketpolicy } from "./s3/bucketpolicy";
import { topic } from "./sns/topic";
import { secret } from "./secretsmanager/secret";
import { topicpolicy } from "./sns/topicpolicy";
import { topicinlinepolicy } from "./sns/topicinlinepolicy";
import { queue } from "./sqs/queue";
import { queuepolicy } from "./sqs/queuepolicy";
import { queueinlinepolicy } from "./sqs/queueinlinepolicy";
import { parameter } from "./ssm/parameter";
import { genericResource } from "./genericResource";

/**
 * Dictionary of all available blocks
 * Key: block identifier (for programmatic access)
 * Value: block definition
 */
export const blocks = {
  cloudformationStack: stack,
  dynamodbTable: table,
  ec2Vpc: vpc,
  s3Bucket: bucket,
  s3Bucketpolicy: bucketpolicy,
  snsTopic: topic,
  secretsmanagerSecret: secret,
  snsTopicpolicy: topicpolicy,
  snsTopicinlinepolicy: topicinlinepolicy,
  sqsQueue: queue,
  sqsQueuepolicy: queuepolicy,
  sqsQueueinlinepolicy: queueinlinepolicy,
  ssmParameter: parameter,
  genericResource: genericResource,
} as const;
