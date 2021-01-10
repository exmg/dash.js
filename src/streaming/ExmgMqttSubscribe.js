import mqtt from 'mqtt';
import {getConsoleFunc} from './ExmgConsole';

const DEBUG = true;

const log = getConsoleFunc(DEBUG, 'exmg-mqtt');

let singletonMqttClient;

/**
 * @param {mqttConfig}
 *
 * @returns {mqtt.Client} See https://github.com/mqttjs/MQTT.js
 */
function createMqttSubscribeClient({host, topic, clientId, username, password}) {

    log('connecting MQTT subscribe');

    const options = {
        clientId,
        username,
        password,
        protocolId: 'MQTT',
        protocolVersion: 4, // actually meaning 3.1.1, while 3 means 3.1 and is incompatible with the latter
        keepalive: 4,
        reconnectPeriod: 1000,
        connectTimeout: 8 * 1000,
        clean: true
    };

    const client = mqtt.connect(host, options);
    client.on('connect', function () {
        // TODO: handle/retry initial connection/sub failures
        client.subscribe(topic, function (err) {
            if (err) {
                console.error('EXMG MQTT:', 'subscribe error: ' + err);
            } else {
                log('subscribed');
            }
        });
    });
    return client;
}

function getSingletonMqttClient(config) {
    if (!singletonMqttClient) {
        singletonMqttClient = createMqttSubscribeClient(config);
    }
    return singletonMqttClient;
}

export {
    createMqttSubscribeClient,
    getSingletonMqttClient
};
