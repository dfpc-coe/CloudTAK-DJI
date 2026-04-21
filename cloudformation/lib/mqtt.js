import cf from '@openaddresses/cloudfriend';

/**
 * Eclipse Mosquitto MQTT broker, run as a Fargate service behind its own
 * internet-facing Network Load Balancer.
 *
 * Why a separate NLB?
 *   - DJI Pilot connects directly to MQTT (TCP 1883), so the broker must be
 *     reachable from the public internet on a stable hostname.
 *   - Keeping it on a dedicated NLB means we can scale / firewall it
 *     independently from the API.
 *
 * The container does not bake its config into the image; instead the entry
 * point materialises `mosquitto.conf` and a `passwd` file from environment
 * variables (`MQTT_USERNAME` / `MQTT_PASSWORD` injected from Secrets Manager)
 * at start-up. This keeps deployment fully driven by CloudFormation.
 */
export default {
  Resources: {
    MQTTDNS: {
        Type: 'AWS::Route53::RecordSet',
        Properties: {
            HostedZoneId: cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-hosted-zone-id'])),
            Type: 'A',
            Name: cf.join([
                cf.ref('MQTTSubdomainPrefix'), '.',
                cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-hosted-zone-name']))
            ]),
            Comment: cf.join(' ', [cf.stackName, 'MQTT broker DNS Entry']),
            AliasTarget: {
                DNSName: cf.getAtt('MQTTELB', 'DNSName'),
                EvaluateTargetHealth: true,
                HostedZoneId: cf.getAtt('MQTTELB', 'CanonicalHostedZoneID')
            }
        }
    },
    MQTTELB: {
        Type: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
        Properties: {
            Name: cf.join('-', [cf.stackName, 'mqtt']),
            Type: 'network',
            Scheme: 'internet-facing',
            SecurityGroups: [cf.ref('MQTTELBSecurityGroup')],
            LoadBalancerAttributes: [{
                Key: 'access_logs.s3.enabled',
                Value: true
            }, {
                Key: 'access_logs.s3.bucket',
                Value: cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-bucket']))
            }, {
                Key: 'access_logs.s3.prefix',
                Value: cf.join('/', [cf.stackName, 'mqtt'])
            }]
        }
    },
    MQTTELBSecurityGroup: {
        Type: 'AWS::EC2::SecurityGroup',
        Properties: {
            Tags: [{ Key: 'Name', Value: cf.join('-', [cf.stackName, 'mqtt-elb-sg']) }],
            GroupName: cf.join('-', [cf.stackName, 'mqtt-elb-sg']),
            GroupDescription: 'Allow access to MQTT broker (1883) from the public internet',
            SecurityGroupIngress: [{
                CidrIp: '0.0.0.0/0',
                IpProtocol: 'tcp',
                FromPort: 1883,
                ToPort: 1883
            }],
            VpcId: cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-vpc']))
        }
    },
    MQTTListener: {
        Type: 'AWS::ElasticLoadBalancingV2::Listener',
        Properties: {
            DefaultActions: [{
                Type: 'forward',
                TargetGroupArn: cf.ref('MQTTTargetGroup')
            }],
            LoadBalancerArn: cf.ref('MQTTELB'),
            Port: 1883,
            Protocol: 'TCP'
        }
    },
    MQTTTargetGroup: {
        Type: 'AWS::ElasticLoadBalancingV2::TargetGroup',
        Properties: {
            Name: cf.join('-', [cf.stackName, 'mqtt-tg']),
            Port: 1883,
            Protocol: 'TCP',
            TargetType: 'ip',
            VpcId: cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-vpc'])),
            HealthCheckEnabled: true,
            HealthCheckProtocol: 'TCP',
            HealthCheckPort: '1883',
            HealthCheckIntervalSeconds: 30,
            HealthCheckTimeoutSeconds: 10,
            HealthyThresholdCount: 3
        }
    },
    MQTTServiceSecurityGroup: {
        Type: 'AWS::EC2::SecurityGroup',
        Properties: {
            Tags: [{ Key: 'Name', Value: cf.join('-', [cf.stackName, 'mqtt-svc-sg']) }],
            GroupDescription: 'Allow MQTT broker traffic from the broker NLB',
            VpcId: cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-vpc'])),
            SecurityGroupIngress: [{
                Description: 'MQTT NLB Traffic',
                CidrIp: '0.0.0.0/0',
                IpProtocol: 'tcp',
                FromPort: 1883,
                ToPort: 1883
            }]
        }
    },
    MQTTLogs: {
        Type: 'AWS::Logs::LogGroup',
        Properties: {
            LogGroupName: cf.join('-', [cf.stackName, 'mqtt']),
            RetentionInDays: 7
        }
    },
    MQTTExecRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
            AssumeRolePolicyDocument: {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: { Service: 'ecs-tasks.amazonaws.com' },
                    Action: 'sts:AssumeRole'
                }]
            },
            Policies: [{
                PolicyName: cf.join([cf.stackName, '-mqtt-exec']),
                PolicyDocument: {
                    Statement: [{
                        Effect: 'Allow',
                        Action: [
                            'logs:CreateLogGroup',
                            'logs:CreateLogStream',
                            'logs:PutLogEvents',
                            'logs:DescribeLogStreams'
                        ],
                        Resource: [cf.join(['arn:', cf.partition, ':logs:*:*:*'])]
                    }, {
                        Effect: 'Allow',
                        Action: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
                        Resource: [
                            cf.join(['arn:', cf.partition, ':secretsmanager:', cf.region, ':', cf.accountId, ':secret:', cf.stackName, '/*'])
                        ]
                    }]
                }
            }],
            ManagedPolicyArns: [
                cf.join(['arn:', cf.partition, ':iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'])
            ],
            Path: '/service-role/'
        }
    },
    MQTTTaskRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
            AssumeRolePolicyDocument: {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: { Service: 'ecs-tasks.amazonaws.com' },
                    Action: 'sts:AssumeRole'
                }]
            },
            Policies: [{
                PolicyName: cf.join('-', [cf.stackName, 'mqtt-task']),
                PolicyDocument: {
                    Statement: [{
                        Effect: 'Allow',
                        Action: [
                            'ssmmessages:CreateControlChannel',
                            'ssmmessages:CreateDataChannel',
                            'ssmmessages:OpenControlChannel',
                            'ssmmessages:OpenDataChannel'
                        ],
                        Resource: '*'
                    }]
                }
            }]
        }
    },
    MQTTTaskDefinition: {
        Type: 'AWS::ECS::TaskDefinition',
        Properties: {
            Family: cf.join([cf.stackName, '-mqtt']),
            Cpu: cf.ref('MQTTComputeCpus'),
            Memory: cf.ref('MQTTComputeMemory'),
            NetworkMode: 'awsvpc',
            RequiresCompatibilities: ['FARGATE'],
            Tags: [{ Key: 'Name', Value: cf.join('-', [cf.stackName, 'mqtt']) }],
            ExecutionRoleArn: cf.getAtt('MQTTExecRole', 'Arn'),
            TaskRoleArn: cf.getAtt('MQTTTaskRole', 'Arn'),
            ContainerDefinitions: [{
                Name: 'mqtt',
                Image: cf.join([cf.accountId, '.dkr.ecr.', cf.region, '.amazonaws.com/coe-ecr-dji:', cf.ref('GitSha'), '-mqtt']),
                PortMappings: [{ ContainerPort: 1883, Protocol: 'tcp' }],
                Environment: [
                    { Name: 'MQTT_USERNAME', Value: 'cloudtak-dji' }
                ],
                Secrets: [
                    {
                        Name: 'MQTT_PASSWORD',
                        ValueFrom: cf.ref('MQTTPasswordSecret')
                    }
                ],
                LogConfiguration: {
                    LogDriver: 'awslogs',
                    Options: {
                        'awslogs-group': cf.join('-', [cf.stackName, 'mqtt']),
                        'awslogs-region': cf.region,
                        'awslogs-stream-prefix': 'mqtt',
                        'awslogs-create-group': true
                    }
                },
                Essential: true
            }]
        }
    },
    MQTTService: {
        Type: 'AWS::ECS::Service',
        DependsOn: ['MQTTListener'],
        Properties: {
            ServiceName: cf.join('-', [cf.stackName, 'MQTT']),
            Cluster: cf.join(['tak-vpc-', cf.ref('Environment')]),
            TaskDefinition: cf.ref('MQTTTaskDefinition'),
            LaunchType: 'FARGATE',
            PropagateTags: 'SERVICE',
            EnableExecuteCommand: cf.ref('EnableExecute'),
            DesiredCount: 1,
            NetworkConfiguration: {
                AwsvpcConfiguration: {
                    AssignPublicIp: 'ENABLED',
                    SecurityGroups: [cf.ref('MQTTServiceSecurityGroup')],
                    Subnets: [
                        cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-subnet-public-a']))
                    ]
                }
            },
            LoadBalancers: [{
                ContainerName: 'mqtt',
                ContainerPort: 1883,
                TargetGroupArn: cf.ref('MQTTTargetGroup')
            }]
        }
    }
  }
};
