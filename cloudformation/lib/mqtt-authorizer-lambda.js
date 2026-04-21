/* eslint-disable @typescript-eslint/no-require-imports */
/* global Buffer, exports, process, require */
'use strict';

const crypto = require('crypto');

function safeEqual(left, right) {
    const leftBuffer = Buffer.from(left || '', 'utf8');
    const rightBuffer = Buffer.from(right || '', 'utf8');

    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function policy(resourceType, topic) {
    return `arn:aws:iot:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:${resourceType}/${topic}`;
}

exports.handler = async (event) => {
    const usernameRaw = event?.protocolData?.mqtt?.username || '';
    const passwordRaw = event?.protocolData?.mqtt?.password || '';
    const username = String(usernameRaw).split('?')[0];
    const password = Buffer.from(String(passwordRaw), 'base64').toString('utf8');

    if (!safeEqual(username, process.env.MQTT_USERNAME) || !safeEqual(password, process.env.MQTT_PASSWORD)) {
        return {
            isAuthenticated: false,
            disconnectAfterInSeconds: 300,
            refreshAfterInSeconds: 300
        };
    }

    return {
        isAuthenticated: true,
        principalId: 'CloudTAKDJI',
        disconnectAfterInSeconds: 86400,
        refreshAfterInSeconds: 300,
        policyDocuments: [{
            Version: '2012-10-17',
            Statement: [{
                Action: ['iot:Connect'],
                Effect: 'Allow',
                Resource: [policy('client', '*')]
            }, {
                Action: ['iot:Publish', 'iot:Receive'],
                Effect: 'Allow',
                Resource: [
                    policy('topic', 'sys/product/*/status'),
                    policy('topic', 'thing/product/*/osd'),
                    policy('topic', 'thing/product/*/state'),
                    policy('topic', 'thing/product/*/services_reply'),
                    policy('topic', 'thing/product/*/events'),
                    policy('topic', 'thing/product/*/services')
                ]
            }, {
                Action: ['iot:Subscribe'],
                Effect: 'Allow',
                Resource: [
                    policy('topicfilter', 'sys/product/*/status'),
                    policy('topicfilter', 'thing/product/*/osd'),
                    policy('topicfilter', 'thing/product/*/state'),
                    policy('topicfilter', 'thing/product/*/services_reply'),
                    policy('topicfilter', 'thing/product/*/events'),
                    policy('topicfilter', 'thing/product/*/services')
                ]
            }]
        }]
    };
};