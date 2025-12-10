import cf from '@openaddresses/cloudfriend';
import API from './lib/api.js';

export default cf.merge(
    API,
    {
        Description: 'Template for CloudTAK-DJI',
        Parameters: {
            GitSha: {
                Description: 'GitSha that is currently being deployed',
                Type: 'String'
            },
            Environment: {
                Description: 'VPC/ECS Stack to deploy into',
                Type: 'String',
                Default: 'prod'
            },
            ComputeCpus: {
                Description: 'Fargate Compute vCPU Units',
                Type: 'Number',
                Default: 1024
            },
            ComputeMemory: {
                Description: 'Fargate Compute Memory in MB',
                Type: 'Number',
                Default: 8192
            },
            SubdomainPrefix: {
                Description: 'Prefix of domain: ie "dji" of dji.example.com',
                Type: 'String'
            },
            EnableExecute: {
                Description: 'Allow SSH into docker container - should only be enabled for limited debugging',
                Type: 'String',
                AllowedValues: ['true', 'false'],
                Default: 'false'
            },
            SSLCertificateIdentifier: {
                Description: 'ACM SSL Certificate for top level wildcard: *.example.com',
                Type: 'String'
            }
        }
    },
);
