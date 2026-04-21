/* eslint-disable @typescript-eslint/no-require-imports */
/* global Buffer, exports, process, require */
'use strict';

const crypto = require('crypto');

const SERVER_CLIENT_PREFIX = 'cloudtak-dji-';

function principalId(clientId) {
    const value = String(clientId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 128);
    return value || 'CloudTAKDJI';
}

function safeEqual(left, right) {
    const leftBuffer = Buffer.from(left || '', 'utf8');
    const rightBuffer = Buffer.from(right || '', 'utf8');

    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function policy(resourceType, topic) {
    return `arn:aws:iot:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:${resourceType}/${topic}`;
}

function allow(action, resource) {
    return {
        Action: action,
        Effect: 'Allow',
        Resource: resource
    };
}

function serverPolicy(clientId) {
    return [{
        Version: '2012-10-17',
        Statement: [
            allow(['iot:Connect'], [policy('client', clientId)]),
            allow(['iot:Subscribe'], [
                policy('topicfilter', 'sys/product/*/status'),
                policy('topicfilter', 'thing/product/*/osd'),
                policy('topicfilter', 'thing/product/*/state'),
                policy('topicfilter', 'thing/product/*/services_reply'),
                policy('topicfilter', 'thing/product/*/events')
            ]),
            allow(['iot:Receive'], [
                policy('topic', 'sys/product/*/status'),
                policy('topic', 'thing/product/*/osd'),
                policy('topic', 'thing/product/*/state'),
                policy('topic', 'thing/product/*/services_reply'),
                policy('topic', 'thing/product/*/events')
            ]),
            allow(['iot:Publish'], [
                policy('topic', 'thing/product/*/services')
            ])
        ]
    }];
}

function devicePolicy(clientId) {
    return [{
        Version: '2012-10-17',
        Statement: [
            allow(['iot:Connect'], [policy('client', clientId)]),
            allow(['iot:Publish'], [
                policy('topic', 'sys/product/*/status'),
                policy('topic', 'thing/product/*/osd'),
                policy('topic', 'thing/product/*/state'),
                policy('topic', 'thing/product/*/services_reply'),
                policy('topic', 'thing/product/*/events')
            ]),
            allow(['iot:Subscribe'], [
                policy('topicfilter', 'thing/product/*/services')
            ]),
            allow(['iot:Receive'], [
                policy('topic', 'thing/product/*/services')
            ])
        ]
    }];
}

exports.handler = async (event) => {
    const usernameRaw = event?.protocolData?.mqtt?.username || '';
    const passwordRaw = event?.protocolData?.mqtt?.password || '';
    const clientId = String(event?.protocolData?.mqtt?.clientId || '').trim();
    const username = String(usernameRaw).split('?')[0];
    const password = Buffer.from(String(passwordRaw), 'base64').toString('utf8');

    if (!clientId || !safeEqual(username, process.env.MQTT_USERNAME) || !safeEqual(password, process.env.MQTT_PASSWORD)) {
        return {
            isAuthenticated: false,
            disconnectAfterInSeconds: 300,
            refreshAfterInSeconds: 300
        };
    }

    const isServerClient = clientId.startsWith(SERVER_CLIENT_PREFIX);

    return {
        isAuthenticated: true,
        principalId: principalId(clientId),
        disconnectAfterInSeconds: 86400,
        refreshAfterInSeconds: 300,
        policyDocuments: isServerClient ? serverPolicy(clientId) : devicePolicy(clientId)
    };
};