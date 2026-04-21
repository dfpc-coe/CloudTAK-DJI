import cf from '@openaddresses/cloudfriend';
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

/**
 * AWS IoT Core custom authorizer resources.
 *
 * We keep the existing DJI login surface (`mqtt_username` / `mqtt_password`)
 * by standing up a simple IoT Core custom authorizer that validates one shared
 * username/password pair. The API container and DJI Pilot both use the same
 * credentials, while the actual broker is AWS IoT Core rather than an ECS
 * Mosquitto task.
 */
export default {
  Resources: {
	IotAuthorizerLogs: {
		Type: 'AWS::Logs::LogGroup',
		Properties: {
			LogGroupName: cf.join(['/aws/lambda/', cf.stackName, '-mqtt-authorizer']),
			RetentionInDays: 7
		}
	},
	IotEndpointLookupLogs: {
		Type: 'AWS::Logs::LogGroup',
		Properties: {
			LogGroupName: cf.join(['/aws/lambda/', cf.stackName, '-iot-endpoint']),
			RetentionInDays: 7
		}
	},
	IotAuthorizerRole: {
		Type: 'AWS::IAM::Role',
		Properties: {
			AssumeRolePolicyDocument: {
				Version: '2012-10-17',
				Statement: [{
					Effect: 'Allow',
					Principal: { Service: 'lambda.amazonaws.com' },
					Action: 'sts:AssumeRole'
				}]
			},
			ManagedPolicyArns: [
				cf.join(['arn:', cf.partition, ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'])
			],
			Policies: [{
				PolicyName: cf.join([cf.stackName, '-mqtt-authorizer-secret']),
				PolicyDocument: {
					Version: '2012-10-17',
					Statement: [{
						Effect: 'Allow',
						Action: ['secretsmanager:GetSecretValue'],
						Resource: [cf.ref('MQTTPasswordSecret')]
					}]
				}
			}]
		}
	},
	IotAuthorizerFunction: {
		Type: 'AWS::Lambda::Function',
		DependsOn: ['IotAuthorizerLogs'],
		Properties: {
			FunctionName: cf.join([cf.stackName, '-mqtt-authorizer']),
			Runtime: 'nodejs24.x',
			Handler: 'index.handler',
			Timeout: 10,
			MemorySize: 128,
			Role: cf.getAtt('IotAuthorizerRole', 'Arn'),
			Environment: {
				Variables: {
					MQTT_USERNAME: 'cloudtak-dji',
					MQTT_PASSWORD: cf.sub('{{resolve:secretsmanager:${AWS::StackName}/mqtt/password:SecretString::AWSCURRENT}}'),
					AWS_ACCOUNT_ID: cf.accountId
				}
			},
			Code: {
				ZipFile: fs.readFileSync(path.join(__dirname, './mqtt-authorizer-lambda.js'), 'utf8')
			}
		}
	},
	IotAuthorizerInvokePermission: {
		Type: 'AWS::Lambda::Permission',
		Properties: {
			Action: 'lambda:InvokeFunction',
			FunctionName: cf.getAtt('IotAuthorizerFunction', 'Arn'),
			Principal: 'iot.amazonaws.com',
			SourceArn: cf.join(['arn:', cf.partition, ':iot:', cf.region, ':', cf.accountId, ':authorizer/', cf.join([cf.stackName, '-mqtt-auth'])])
		}
	},
	MQTTAuthorizer: {
		Type: 'AWS::IoT::Authorizer',
		DependsOn: ['IotAuthorizerInvokePermission'],
		Properties: {
			AuthorizerName: cf.join([cf.stackName, '-mqtt-auth']),
			AuthorizerFunctionArn: cf.getAtt('IotAuthorizerFunction', 'Arn'),
			SigningDisabled: true,
			Status: 'ACTIVE'
		}
	},
	IotEndpointLookupRole: {
		Type: 'AWS::IAM::Role',
		Properties: {
			AssumeRolePolicyDocument: {
				Version: '2012-10-17',
				Statement: [{
					Effect: 'Allow',
					Principal: { Service: 'lambda.amazonaws.com' },
					Action: 'sts:AssumeRole'
				}]
			},
			ManagedPolicyArns: [
				cf.join(['arn:', cf.partition, ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'])
			],
			Policies: [{
				PolicyName: cf.join([cf.stackName, '-iot-endpoint']),
				PolicyDocument: {
					Version: '2012-10-17',
					Statement: [{
						Effect: 'Allow',
						Action: ['iot:DescribeEndpoint'],
						Resource: '*'
					}]
				}
			}]
		}
	},
	IotEndpointLookupFunction: {
		Type: 'AWS::Lambda::Function',
		DependsOn: ['IotEndpointLookupLogs'],
		Properties: {
			FunctionName: cf.join([cf.stackName, '-iot-endpoint']),
			Runtime: 'nodejs24.x',
			Handler: 'index.handler',
			Timeout: 30,
			MemorySize: 128,
			Role: cf.getAtt('IotEndpointLookupRole', 'Arn'),
			Code: {
				ZipFile: fs.readFileSync(path.join(__dirname, './mqtt-endpoint-lambda.js'), 'utf8')
			}
		}
	},
	IotDataEndpoint: {
		Type: 'Custom::IotDataEndpoint',
		Properties: {
			ServiceToken: cf.getAtt('IotEndpointLookupFunction', 'Arn')
		}
	}
  }
};
