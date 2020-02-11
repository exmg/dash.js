import ISOBoxer from 'codem-isoboxer';
import FactoryMaker from '../core/FactoryMaker';

ExmgFragmentDecrypt.__dashjs_factory_name = 'ExmgFragmentDecrypt';
export default FactoryMaker.getSingletonFactory(ExmgFragmentDecrypt);

const MQTT_HOST = "wss://mqtt.liveryvideo.com?jwt=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyLWlkIjoid2ViMSIsImF1dGgtZ3JvdXBzIjoic3Vic2NyaWJlIn0.jovY0SCF9OZbsaj9Rx4yB8aN9QYxUNAOCd7m3TEkI49mu_3u1r3kqe27dOYOc1MrHOx0ezv2OQIYjum60mOTKr1W4jtNrXtpzAkheTu_j2pOffeKiz-8oNg-C99mvlXTad0XrRCiP30R_3UoKh7GzgwgWw0eJhr37RiyPILn-5R-cuVHZoh8ddWaQHyIYk2HfQQTAHtAdc56BHPWxiN196NpjYEnBitdBBG0CTpcxTula9kBS8vvek5Sdd3SMjAT3tGw0fX3RgHJMhbQYKxdpzz_Njnfh1f4MCJgFHZiu1O7obO-TmuiT-diWP4xD0JkryJ0a3rpqh61--Bt_3NDgVJzsKvg3JpHkOJtRAaR5keHAa5BRB_j1iGXr-0PBt8aRRL7NyFUtyh7QbcVAEA2txEIgPH767q-5poLfM-yF1zp7XtDZrYXMdJy3cIDOZ4zJJWrOAL1D8AaWLGIsFHXY5l3-7ptc0QapTFh1OZP3rbvV-yR0TfXJyFTKrKg6F9ULVHN6XEcz7PNfzG-x5Ca6SXa36oY4d8siC7SYnLh5jY1iGbarfwer37BgUBIpXsGAjMyOuw7DU5JsmVC6vzq9mNkFgfn7xTNHFjOZunn605DzA9R4-B2Dgs2cOSXKZcJoV-C-IdoE_z4v_15wXI-IMq7XwtzArnLi256KayX_js";
const MQTT_TOPIC = 'joep/test';
const MQTT_CLIENT_ID = 'web1';

const DIGEST_RETRY_TIMEOUT_MS = 3000;

/**
 * @param {Uint8Array} cipherData Encrypted data buffer
 * @param {Uint8Array} key 16-bytes (128 bits) key
 * @param {Uint8Array} iv 8 bytes (64 bits) IV
 * @returns {Promise<Uint8Array>}
 */
function decryptAesCtr(cipherData, key, iv) {
    if (!crypto) {
        throw new Error('WebCrypto API not available');
    }
    const algoId = 'AES-CTR';
    return crypto.subtle.importKey(
        'raw',
        key,
        algoId,
        false,
        ['decrypt']
    ).then((keyObj) => {
        return crypto.subtle.decrypt(
            {
                name: algoId,
                counter: iv,
                length: 64, // we use an 8-byte IV
            },
            keyObj,
            cipherData
        )
        .then(function(clearData){
            return new Uint8Array(clearData);
        })
        .catch(function(err){
            console.error('Error decrypting AES-CTR cipherdata: ' + err.message);
        });
    });
}

function ExmgFragmentDecrypt(config) {
    let instance;
    let clientCreated = false;

    /**
     * @type {ExmgCipherMessage[]}
     */
    const cipherMessages = [];
    const movInitDataHash = {}
    const client = createExmgMqttSubscribeClient(onMqttMessage);
    const perf = window.performance;

    /**
     * @param {string} message
     */
    function onMqttMessage(message) {
        let messageObj;
        // may fail if JSON message data is broken
        try {
            messageObj = JSON.parse(message);
            //console.trace('Parsed received cipher message:', messageObj);
        } catch (err) {
            console.error('Failed to parse JSON:', message);
            console.error(err);
            return;
        }
        cipherMessages.push(messageObj);
    }

    /**
     *
     * @param {Uint8Array} data
     * @param {(Uint8Array) => void} onResult
     */
    function digestFragmentBuffer(data, onResult) {
        // parse whole segment with ISO-FF
        let parsedFile = ISOBoxer.parseBuffer(data);

        // check for init data
        const tkhd = parsedFile.fetch('tkhd');
        if (tkhd) {
            // map useful track info to id
            const mdhd = parsedFile.fetch('mdhd');
            movInitDataHash[tkhd.track_ID] = {
                timescale: mdhd.timescale
            };
            // return early, nothing more to do
            onResult(data);
            return;
        }

        // should be a (moof/mdat)s segment, check for traf boxes
        const trafs = parsedFile.fetchAll('traf');
        if (trafs.length === 0) {
            console.warn('Media segment was not init data but has not track fragments');
            onResult(data);
            return;
        }

        const now = perf.now();

        let keyFailure = false;

        // retrieve all mdats, lookup key-message by baseMediaDecodeTime
        // and decrypt the payload
        const mdats = parsedFile.fetchAll('mdat');
        const clearBufferPromises = [];

        for (let index = 0; index < trafs.length; index++) {
            const trafBox = trafs[index];

            // compute track fragment first PTS seconds
            const tfhd = trafBox.boxes[0];
            const tfdt = trafBox.boxes[1];
            const trackInfo = movInitDataHash[tfhd.track_ID];
            const firstPtsSeconds = tfdt.baseMediaDecodeTime / trackInfo.timescale;

            // lookup key
            const cipherMessageForBuffer = findCipherMessageByMediaTime(firstPtsSeconds);
            if (!cipherMessageForBuffer) {
                console.warn('No matching cipher message for media fragment starting at:', firstPtsSeconds, 'secs');
                console.warn('Re-scheduling media fragment decryptor digest!');
                // if the key message has not arrived yet, re-try in a bit
                setTimeout(() => {
                    digestFragmentBuffer(data, onResult);
                }, DIGEST_RETRY_TIMEOUT_MS)
                keyFailure = true;
                break;
            }

            //console.log('Media fragment matching cipher message found:', cipherMessageForBuffer);

            // create full key data from short keys
            const keyShort = new Uint32Array([cipherMessageForBuffer.exmg_key]);
            const ivShort = new Uint16Array([cipherMessageForBuffer.exmg_iv]);
            const key = new Uint8Array(16);
            const iv = new Uint8Array(16);
            key.set(keyShort, 0);
            iv.set(ivShort, 0);

            // decrypt the mdat buffer
            const mdat = mdats[index];
            clearBufferPromises.push(decryptAesCtr(mdat.data, key, iv));
        };

        if (keyFailure) {
            return;
        }

        // awaiting all decrypt promise results ...
        Promise.all(clearBufferPromises).then((clearBuffers) => {
            const decryptTimeMs = perf.now() - now;
            console.log(`Decrypted ${clearBuffers.length} fragment buffers in ${decryptTimeMs.toFixed(3)} ms`)
            // TODO: write results back into original downloaded segment data here
            onResult(data);
        });
    }

    /**
     * @param {number} mediaTimeSecs
     * @returns {ExmgCipherMessage}
     */
    function findCipherMessageByMediaTime(mediaTimeSecs) {
        let matchMsg = null;
        // putting a try in case the message data is broken to catch it here
        try {
            // FIXME: replace by a binary search algo to be more efficient (this has O(N))
            for (let index = 0; index < cipherMessages.length; index++) {
                const msg = cipherMessages[index];
                const firstPtsSeconds = msg.exmg_track_fragment_info.media_time_in_seconds;
                if (firstPtsSeconds <= mediaTimeSecs) {
                    if (index === cipherMessages.length - 1) {
                        matchMsg = msg;
                        break;
                    }

                    const nextFragmentFirstPtsSecs
                        = cipherMessages[index + 1]
                            .exmg_track_fragment_info
                            .media_time_in_seconds;

                    if (nextFragmentFirstPtsSecs > mediaTimeSecs) {
                        matchMsg = msg;
                        break;
                    }
                }
            }
        } catch(err) {
            console.error('Error looking up cipher message info:', err);
            return null;
        }
        return matchMsg;
    }

    function createExmgMqttSubscribeClient(onMessage) {

        if (clientCreated) {
            throw new Error('MQTT client create function shall only be called once');
        }

        console.log('EXMG MQTT:', 'connecting MQTT subscribe')

        var host = MQTT_HOST;

        var options = {
            keepalive: 10,
            protocolId: 'MQTT',
            protocolVersion: 4,
            clean: true,
            reconnectPeriod: 1000,
            connectTimeout: 30*1000,
            clientId: MQTT_CLIENT_ID
        };
        var client = mqtt.connect(host, options);

        client.on('connect', function () {
            // FIXME: handle/retry initial connection/sub failures
            client.subscribe(MQTT_TOPIC, function (err) {
                if (err)
                    console.error('EXMG MQTT:', 'subscribe error: ' + err);
                else
                    console.log('EXMG MQTT:', 'subscribed');
            });
        });


        client.on('message', function (topic, message) {
            onMessage(message.toString());
        });

        clientCreated = true;

        return client;
    }

    instance = {
        client,
        digestFragmentBuffer
    }

    return instance;
}
