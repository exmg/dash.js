import { v4 as getUuid } from 'uuid';

const MQTT_HOST = "ws://xvm-190-41.dc0.ghst.net:8885/mqtt";
const MQTT_TOPIC = '/mqtt';
const MQTT_CLIENT_ID = getUuid();
const MQTT_USERNAME = "user1";
const MQTT_PASSWORD = "liverymqtt123";

let mqttClient = null;

mqttClient = createMqttSubscribeClient(onMqttMessageRcv);

function createMqttSubscribeClient(onMessage) {

    console.info('EXMG MQTT:', 'connecting MQTT subscribe');

    const host = MQTT_HOST;
    const options = {
        clientId: MQTT_CLIENT_ID,
        username: MQTT_USERNAME,
        password: MQTT_PASSWORD,
        protocolId: 'MQTT',
        protocolVersion: 4, // actually meaning 3.1.1, while 3 means 3.1 and is incompatible with the latter
        keepalive: 4,
        reconnectPeriod: 1000,
        connectTimeout: 8 * 1000,
        clean: true
    };

    if (!window.mqtt) {
        throw new Error('`mqtt` is not defined in window scope');
    }

    const client = window.mqtt.connect(host, options);
    client.on('connect', function () {
        // TODO: handle/retry initial connection/sub failures
        client.subscribe(MQTT_TOPIC, function (err) {
            if (err) {
                console.error('EXMG MQTT:', 'subscribe error: ' + err);
            } else {
                console.info('EXMG MQTT:', 'subscribed');
            }
        });
    });
    client.on('message', function (topic, message) {
        console.log('EXMG MQTT:', topic, message)
        onMessage(message.toString());
    });
    return client;
}

/*
// TODO: destroy client when player terminates session
function disposeMqttSubClient() {

}
*/

function onMqttMessageRcv(data) {
    console.log(data);
}

export {
    mqttClient
};
