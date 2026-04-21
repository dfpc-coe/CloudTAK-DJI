import cf from '@openaddresses/cloudfriend';
import API from './lib/api.js';
import MQTT from './lib/mqtt.js';
import Secrets from './lib/secrets.js';

export default cf.merge(
    Secrets,
    MQTT,
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
                Description: 'Fargate Compute vCPU Units (API)',
                Type: 'Number',
                Default: 1024
            },
            ComputeMemory: {
                Description: 'Fargate Compute Memory in MB (API)',
                Type: 'Number',
                Default: 8192
            },
            MQTTComputeCpus: {
                Description: 'Fargate Compute vCPU Units (MQTT broker)',
                Type: 'Number',
                Default: 512
            },
            MQTTComputeMemory: {
                Description: 'Fargate Compute Memory in MB (MQTT broker)',
                Type: 'Number',
                Default: 1024
            },
            SubdomainPrefix: {
                Description: 'Prefix of the API/UI domain: ie "dji" of dji.example.com',
                Type: 'String'
            },
            MQTTSubdomainPrefix: {
                Description: 'Prefix of the MQTT broker domain handed to DJI Pilot: ie "dji-mqtt" of dji-mqtt.example.com',
                Type: 'String',
                Default: 'dji-mqtt'
            },
            CloudTAKURL: {
                Description: 'Base URL of the upstream CloudTAK API (no trailing slash)',
                Type: 'String'
            },
            WorkspaceId: {
                Description: 'DJI Cloud API workspace_id handed back to DJI Pilot',
                Type: 'String',
                Default: 'default-workspace'
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
