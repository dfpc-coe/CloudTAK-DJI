import cf from '@openaddresses/cloudfriend';

export default {
    ELBDNS: {
        Type: 'AWS::Route53::RecordSet',
        Properties: {
            HostedZoneId: cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-hosted-zone-id'])),
            Type : 'A',
            Name: cf.join([cf.ref('SubdomainPrefix'), '.', cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-hosted-zone-name']))]),
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
            // Disabled as DualStack currently does not support IPv6 UDP
            // ref: https://docs.aws.amazon.com/whitepapers/latest/ipv6-on-aws/scaling-the-dual-stack-network-design-in-aws.html
            // EnablePrefixForIpv6SourceNat: 'on',
            // IpAddressType: 'dualstack',
            SecurityGroups: [cf.ref('ELBSecurityGroup')],
            LoadBalancerAttributes: [{
                Key: 'access_logs.s3.enabled',
                Value: true
            },{
                Key: 'access_logs.s3.bucket',
                Value: cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-bucket']))
            },{
                Key: 'access_logs.s3.prefix',
                Value: cf.stackName
            }],
        }
    },
    ELBSecurityGroup: {
        Type : 'AWS::EC2::SecurityGroup',
        Properties : {
            Tags: [{
                Key: 'Name',
                Value: cf.join('-', [cf.stackName, 'elb-sg'])
            }],
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
            Cpu: cf.ref('ComputeCpus'),
            Memory: cf.ref('ComputeMemory'),
            NetworkMode: 'awsvpc',
            RequiresCompatibilities: ['FARGATE'],
            Tags: [{
                Key: 'Name',
                Value: cf.join('-', [cf.stackName, 'api'])
            }],
            ExecutionRoleArn: cf.getAtt('ExecRole', 'Arn'),
            TaskRoleArn: cf.getAtt('TaskRole', 'Arn'),
            Volumes: [{
                Name: cf.stackName,
                EFSVolumeConfiguration: {
                    FilesystemId: cf.ref('EFSFileSystem')
                }
            }],
            ContainerDefinitions: [{
                Name: 'api',
                Image: cf.join([cf.accountId, '.dkr.ecr.', cf.region, '.amazonaws.com/coe-ecr-dji:', cf.ref('GitSha')]),
                PortMappings: [{
                    ContainerPort: 5003,
                    Protocol: 'tcp'
                }],
                Environment: [
                    { Name: 'StackName', Value: cf.stackName },
                    { Name: 'Environment', Value: cf.ref('Environment') },
                    { Name: 'API_URL', Value: cf.ref('CloudTAKURL') },
                    { Name: 'AWS_REGION', Value: cf.region }
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
                    Principal: {
                        Service: 'ecs-tasks.amazonaws.com'
                    },
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
                    Principal: {
                        Service: 'ecs-tasks.amazonaws.com'
                    },
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
                    },{
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
        DependsOn: ['ListenerApi'],
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
                    Subnets:  [
                        cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-subnet-public-a']))
                    ]
                }
            },
            LoadBalancers: [{
                ContainerName: 'api',
                ContainerPort: 5003,
                TargetGroupArn: cf.ref(`TargetGroupApi`)
            }]
        }
    },
    ServiceSecurityGroup: {
        Type: 'AWS::EC2::SecurityGroup',
        Properties: {
            Tags: [{
                Key: 'Name',
                Value: cf.join('-', [cf.stackName, 'ec2-sg'])
            }],
            GroupDescription: 'Allow access to Media ports',
            VpcId: cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-vpc'])),
            SecurityGroupIngress: [{
                Description: 'ELB Traffic',
                SourceSecurityGroupId: cf.ref('ELBSecurityGroup'),
                IpProtocol: 'tcp',
                FromPort: 5003,
                ToPort: 5003
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
            Protocol: 'TCP'
        }
    },
    TargetGroupApi: {
        Type: 'AWS::ElasticLoadBalancingV2::TargetGroup',
        Properties: {
            Port: 5003,
            Protocol: 'TCP',
            TargetType: 'ip',
            VpcId: cf.importValue(cf.join(['tak-vpc-', cf.ref('Environment'), '-vpc'])),

            HealthCheckEnabled: true,
            HealthCheckIntervalSeconds: 30,

            // UDP Health checks fallback to TCP
            HealthCheckPort: '5003',
            HealthCheckProtocol: 'TCP',
            HealthCheckPath: '/api',
            HealthCheckTimeoutSeconds: 10,
            HealthyThresholdCount: 5
        }
    }
};
