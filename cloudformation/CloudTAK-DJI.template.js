import cf from '@openaddresses/cloudfriend';
import API from './lib/api.js';
import Secrets from './lib/secrets.js';

export default cf.merge(
    Secrets,
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
            WorkspaceId: {
                Description: 'DJI Cloud API workspace_id handed back to DJI Pilot',
                Type: 'String',
                Default: '00000000-0000-0000-0000-000000000000',
                AllowedPattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
                ConstraintDescription: 'Must be a UUID, e.g. 00000000-0000-0000-0000-000000000000'
            },
            PlatformName: {
                Description: 'Display name for the Pilot "Cloud Service" tile (platformSetInformation). Without this, the tile stays "Not Logged In" even when MQTT is connected.',
                Type: 'String',
                Default: 'CloudTAK'
            },
            WorkspaceName: {
                Description: 'Workspace display name shown on the Pilot "Cloud Service" tile.',
                Type: 'String',
                Default: 'CloudTAK'
            },
            WorkspaceDesc: {
                Description: 'Optional description shown on the Pilot "Cloud Service" tile.',
                Type: 'String',
                Default: ''
            },
            MediaURL: {
                Description: 'Base RTMP URL of the operator-supplied media server (e.g. rtmp://media.example.com:1935/live). Required for DJI Pilot livestream pushes; leave empty to require an explicit `url` per livestream API call.',
                Type: 'String',
                Default: ''
            },
            DJIAppId: {
                Description: 'DJI Pilot Cloud API app_id (integer issued by DJI). Required for the controller web-view to verify its license and bring the Cloud Service online.',
                Type: 'Number',
                Default: 0
            },
            DJIAppKey: {
                Description: 'DJI Pilot Cloud API app_key issued alongside the app_id.',
                Type: 'String',
                Default: '',
            },
            DJIAppLicense: {
                Description: 'DJI Pilot Cloud API license string issued by DJI for this app_id/app_key pair.',
                Type: 'String',
                Default: '',
            },
            EnableExecute: {
                Description: 'Allow SSH into docker container - should only be enabled for limited debugging',
                Type: 'String',
                AllowedValues: ['true', 'false'],
                Default: 'false'
            }
        }
    },
);
