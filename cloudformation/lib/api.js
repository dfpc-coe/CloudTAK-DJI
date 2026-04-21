import cf from '@openaddresses/cloudfriend';

/**
 * CloudTAK-DJI API + Web UI service.
 *
 * Sits behind its own internet-facing NLB on TCP 443. The container reads
 * upstream CloudTAK and MQTT broker coordinates from environment variables;
 * the JWT signing secret and MQTT password are injected from Secrets
 * Manager (see lib/secrets.js, lib/mqtt.js).
 */
export default {
  Resources: {
    ELBDNS: {
        Type: 'AWS::Route53::RecordSet',
        Properties: {
            HostedZoneId: cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-hosted-zone-id'])),
            Type: 'A',
            Name: cf.join(['dji.', cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-hosted-zone-name']))]),
            Comment: cf.join(' ', [cf.stackName, 'DNS Entry']),
            AliasTarget: {
                DNSName: cf.getAtt('ELB', 'DNSName'),
                EvaluateTargetHealth: true,
                HostedZoneId: cf.getAtt('ELB', 'CanonicalHostedZoneID')
            }
        }
    },
    Logs: {
        Type: 'AWS::Logs::LogGroup',
        Properties: {
            LogGroupName: cf.stackName,
            RetentionInDays: 7
        }
    },
    ELB: {
        Type: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
        Properties: {
            Name: cf.stackName,
            Type: 'network',
            Scheme: 'internet-facing',
            SecurityGroups: [cf.ref('ELBSecurityGroup')],
            LoadBalancerAttributes: [{
                Key: 'access_logs.s3.enabled',
                Value: true
            }, {
                Key: 'access_logs.s3.bucket',
                Value: cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-bucket']))
            }, {
                Key: 'access_logs.s3.prefix',
                Value: cf.stackName
            }]
        }
    },
    ELBSecurityGroup: {
        Type: 'AWS::EC2::SecurityGroup',
        Properties: {
            Tags: [{ Key: 'Name', Value: cf.join('-', [cf.stackName, 'elb-sg']) }],
            GroupName: cf.join('-', [cf.stackName, 'elb-sg']),
            GroupDescription: 'Allow Access to ELB',
            SecurityGroupIngress: [{
                CidrIp: '0.0.0.0/0',
                IpProtocol: 'tcp',
                FromPort: 443,
                ToPort: 443
            }],
            VpcId: cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-vpc']))
        }
    },
    ServiceTaskDefinition: {
        Type: 'AWS::ECS::TaskDefinition',
        Properties: {
            Family: cf.join([cf.stackName, '-service']),
            Cpu: 1024,
            Memory: 8192,
            NetworkMode: 'awsvpc',
            RequiresCompatibilities: ['FARGATE'],
            Tags: [{ Key: 'Name', Value: cf.join('-', [cf.stackName, 'api']) }],
            ExecutionRoleArn: cf.getAtt('ExecRole', 'Arn'),
            TaskRoleArn: cf.getAtt('TaskRole', 'Arn'),
            ContainerDefinitions: [{
                Name: 'api',
                Image: cf.join([cf.accountId, '.dkr.ecr.', cf.region, '.amazonaws.com/tak-vpc-', cf.ref('Environment'), '-cloudtak-dji:api-', cf.ref('GitSha')]),
                PortMappings: [{
                    ContainerPort: 5004,
                    Protocol: 'tcp'
                }],
                Environment: [
                    { Name: 'StackName', Value: cf.stackName },
                    { Name: 'Environment', Value: cf.ref('Environment') },
                    { Name: 'API_URL', Value: cf.ref('CloudTAKURL') },
                    { Name: 'AWS_REGION', Value: cf.region },
                    { Name: 'WORKSPACE_ID', Value: cf.ref('WorkspaceId') },
                    // The API container talks to the broker via the MQTT NLB
                    // (DNS resolves inside the VPC just fine).
                    {
                        Name: 'MQTT_URL',
                        Value: cf.join(['mqtt://', cf.getAtt('MQTTELB', 'DNSName'), ':1883'])
                    },
                    // What we hand back to DJI Pilot in /manage/api/v1/iam/login.
                    {
                        Name: 'MQTT_PUBLIC_URL',
                        Value: cf.join([
                            'mqtt://',
                            cf.ref('MQTTSubdomainPrefix'), '.',
                            cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-hosted-zone-name'])),
                            ':1883'
                        ])
                    },
                    { Name: 'MQTT_USERNAME', Value: 'cloudtak-dji' }
                ],
                Secrets: [
                    {
                        Name: 'SigningSecret',
                        ValueFrom: cf.ref('APISigningSecret')
                    },
                    {
                        Name: 'MQTT_PASSWORD',
                        ValueFrom: cf.ref('MQTTPasswordSecret')
                    }
                ],
                LogConfiguration: {
                    LogDriver: 'awslogs',
                    Options: {
                        'awslogs-group': cf.stackName,
                        'awslogs-region': cf.region,
                        'awslogs-stream-prefix': cf.stackName,
                        'awslogs-create-group': true
                    }
                },
                Essential: true
            }]
        }
    },
    ExecRole: {
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
                PolicyName: cf.join([cf.stackName, '-api-logging']),
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
                        // Required so the ECS agent can resolve `Secrets` ValueFrom
                        // entries before launching the container.
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
    TaskRole: {
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
                PolicyName: cf.join('-', [cf.stackName, 'api-policy']),
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
                    }, {
                        Effect: 'Allow',
                        Action: [
                            'logs:CreateLogGroup',
                            'logs:CreateLogStream',
                            'logs:PutLogEvents',
                            'logs:DescribeLogStreams'
                        ],
                        Resource: [cf.join(['arn:', cf.partition, ':logs:*:*:*'])]
                    }]
                }
            }]
        }
    },
    Service: {
        Type: 'AWS::ECS::Service',
        DependsOn: ['ListenerApi', 'MQTTService'],
        Properties: {
            ServiceName: cf.join('-', [cf.stackName, 'Service']),
            Cluster: cf.join(['tak-vpc-', cf.ref('Environment')]),
            TaskDefinition: cf.ref('ServiceTaskDefinition'),
            LaunchType: 'FARGATE',
            PropagateTags: 'SERVICE',
            EnableExecuteCommand: cf.ref('EnableExecute'),
            DesiredCount: 1,
            NetworkConfiguration: {
                AwsvpcConfiguration: {
                    AssignPublicIp: 'ENABLED',
                    SecurityGroups: [cf.ref('ServiceSecurityGroup')],
                    Subnets: [
                        cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-subnet-public-a']))
                    ]
                }
            },
            LoadBalancers: [{
                ContainerName: 'api',
                ContainerPort: 5004,
                TargetGroupArn: cf.ref('TargetGroupApi')
            }]
        }
    },
    ServiceSecurityGroup: {
        Type: 'AWS::EC2::SecurityGroup',
        Properties: {
            Tags: [{ Key: 'Name', Value: cf.join('-', [cf.stackName, 'ec2-sg']) }],
            GroupDescription: 'CloudTAK-DJI API service network access',
            VpcId: cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-vpc'])),
            SecurityGroupIngress: [{
                Description: 'API NLB Traffic',
                CidrIp: '0.0.0.0/0',
                IpProtocol: 'tcp',
                FromPort: 5004,
                ToPort: 5004
            }]
        }
    },
    ListenerApi: {
        Type: 'AWS::ElasticLoadBalancingV2::Listener',
        Properties: {
            Certificates: [{
                CertificateArn: cf.join(['arn:', cf.partition, ':acm:', cf.region, ':', cf.accountId, ':certificate/', cf.ref('SSLCertificateIdentifier')])
            }],
            DefaultActions: [{
                Type: 'forward',
                TargetGroupArn: cf.ref('TargetGroupApi')
            }],
            LoadBalancerArn: cf.ref('ELB'),
            Port: 443,
            Protocol: 'TLS'
        }
    },
    TargetGroupApi: {
        Type: 'AWS::ElasticLoadBalancingV2::TargetGroup',
        Properties: {
            Name: cf.join('-', [cf.stackName, 'api-tg']),
            Port: 5004,
            Protocol: 'TCP',
            TargetType: 'ip',
            VpcId: cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-vpc'])),
            HealthCheckEnabled: true,
            HealthCheckIntervalSeconds: 30,
            HealthCheckPort: '5004',
            HealthCheckProtocol: 'HTTP',
            HealthCheckPath: '/api',
            HealthCheckTimeoutSeconds: 10,
            HealthyThresholdCount: 5
        }
    }
  }
};
