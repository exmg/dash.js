import ISOBoxer from 'codem-isoboxer';
import FactoryMaker from '../core/FactoryMaker';
import DashJSError from './vo/DashJSError';
import Errors from './../core/errors/Errors';
import Settings from './../core/Settings';

ExmgFragmentDecrypt.__dashjs_factory_name = 'ExmgFragmentDecrypt';
export default FactoryMaker.getSingletonFactory(ExmgFragmentDecrypt);

/*
const MQTT_HOST = "wss://mqtt.liveryvideo.com?jwt=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyLWlkIjoid2ViMSIsImF1dGgtZ3JvdXBzIjoic3Vic2NyaWJlIn0.jovY0SCF9OZbsaj9Rx4yB8aN9QYxUNAOCd7m3TEkI49mu_3u1r3kqe27dOYOc1MrHOx0ezv2OQIYjum60mOTKr1W4jtNrXtpzAkheTu_j2pOffeKiz-8oNg-C99mvlXTad0XrRCiP30R_3UoKh7GzgwgWw0eJhr37RiyPILn-5R-cuVHZoh8ddWaQHyIYk2HfQQTAHtAdc56BHPWxiN196NpjYEnBitdBBG0CTpcxTula9kBS8vvek5Sdd3SMjAT3tGw0fX3RgHJMhbQYKxdpzz_Njnfh1f4MCJgFHZiu1O7obO-TmuiT-diWP4xD0JkryJ0a3rpqh61--Bt_3NDgVJzsKvg3JpHkOJtRAaR5keHAa5BRB_j1iGXr-0PBt8aRRL7NyFUtyh7QbcVAEA2txEIgPH767q-5poLfM-yF1zp7XtDZrYXMdJy3cIDOZ4zJJWrOAL1D8AaWLGIsFHXY5l3-7ptc0QapTFh1OZP3rbvV-yR0TfXJyFTKrKg6F9ULVHN6XEcz7PNfzG-x5Ca6SXa36oY4d8siC7SYnLh5jY1iGbarfwer37BgUBIpXsGAjMyOuw7DU5JsmVC6vzq9mNkFgfn7xTNHFjOZunn605DzA9R4-B2Dgs2cOSXKZcJoV-C-IdoE_z4v_15wXI-IMq7XwtzArnLi256KayX_js";
const MQTT_TOPIC = 'joep/test';
const MQTT_CLIENT_ID = 'web1';
//*/

const DIGEST_RETRY_TIMEOUT_MS = 5000;
const KEY_SCOPE_SECONDS = 2.0
const DEBUG = true;

/**
 * @param {Uint8Array} cipherData Encrypted data buffer
 * @param {Uint8Array} key 16-bytes (128 bits) key
 * @param {Uint8Array} iv 8 bytes (64 bits) IV
 * @returns {Promise<Uint8Array>}
 */
function decryptAesCtr(cipherData, key, iv) {
    const crypto = window.crypto;
    if (!crypto || !crypto.subtle) {
        throw new Error('WebCrypto (Subtle) API not available');
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

/**
 *
 * @param {string} codecType
 * @param {number} trackId
 * @param {number} pts
 * @returns {Promise<string | null | Error>}
 */
function fetchKeyMessage(codecType, trackId, pts) {
    const url = keyFilesBaseUrl + `/exmg_key_${codecType}_${trackId}_${pts}.json`;
    return fetchKeyMessageUrl(url);
}

function fetchKeyMessageUrl(url) {
    return new Promise((resolve, reject) => {
        fetch(url).then((res) => res.ok && res.text())
            .then((message) => {
                if (!message) {
                    reject(null);
                    return;
                }
                //console.log('Received messsage:', JSON.parse(message));
                resolve(message);
            })
            .catch((err) => {
                console.error('Fatal error fetching key-message:', err);
                reject(err);
            });
    });
}

/**
 *
 * @param {string} codecType
 * @returns {Promise<string | null>}
 */
function fetchKeyIndex(keyFilesBaseUrl, codecType, retries = 3) {
    const url = keyFilesBaseUrl + '/exmg_key_index_' + codecType;
    return fetch(url)
        .then((response) => {
            if (response.ok) {
                return response.text();
            } else {
                if (retries >= 0) {
                    console.warn('Retrial attempts for fetching key-index. Counter:', retries);
                    return fetchKeyIndex(url, codecType, --retries);
                } else {
                    return null;
                }
            }
        })
}

function ExmgFragmentDecrypt(config) {

    config = config || {};

    const keyFilesBaseUrl = Settings(context).getInstance().get().streaming.keyFilesBaseUrl;

    const context = this.context;

    console.log('Created ExmgFragmentDecrypt');

    let instance;
    let clientCreated = false;

    let audioKeyIndex = null;
    let videoKeyIndex = null;
    let keyIndexUpdateInterval = null;

    const audioKeyMap = {}
    const videoKeyMap = {}

    /**
     * @type {[track_id] => ExmgCipherMessage[]}
     */
    const cipherMessageHash = {};

    const movInitDataHash = {};

    const perf = window.performance;

    let mqttClient = null; //mqttClient = createMqttSubscribeClient(onCipherMessage);

    const keyIndexUpdateMs = 2 * KEY_SCOPE_SECONDS * 1000;

    //*
    keyIndexUpdateInterval = setInterval(() => {
        fetchKeyIndex(keyFilesBaseUrl, 'audio').then((index) => {
            audioKeyIndex = index.split('\n');
            audioKeyIndex
                = audioKeyIndex.map((url) => url.substr(url.lastIndexOf('/') + 1))
                                .filter((url) => !!url.length);
            //console.log(audioKeyIndex)
            fetchKeysOnIndexUpdated('audio')
        });
        fetchKeyIndex(keyFilesBaseUrl, 'video').then((index) => {
            videoKeyIndex = index.split('\n')
            videoKeyIndex
                = videoKeyIndex.map((url) => url.substr(url.lastIndexOf('/') + 1))
                                .filter((url) => !!url.length);
            //console.log(videoKeyIndex)
            fetchKeysOnIndexUpdated('video')
        });
    }, keyIndexUpdateMs)
    //*/

    function fetchKeysOnIndexUpdated(codecType) {
        switch (codecType) {
        case 'audio':
            audioKeyIndex.forEach((url) => {
                if (!audioKeyMap[url]) {
                    audioKeyMap[url] = true;
                    fetchKeyMessageUrl(keyFilesBaseUrl + url)
                        .then((message) => {
                            audioKeyMap[url] = message;
                            onCipherMessage(message);
                        })
                        .catch((err) => {
                            console.warn('Failure to retrieve key (no retrial)!')
                            console.error(err);
                        });
                }
            })
            break;
        case 'video':
            videoKeyIndex.forEach((url) => {
                if (!videoKeyMap[url]) {
                    videoKeyMap[url] = true;
                    fetchKeyMessageUrl(keyFilesBaseUrl + url)
                        .then((message) => {
                            videoKeyMap[url] = message;
                            onCipherMessage(message);
                        })
                        .catch((err) => {
                            console.warn('Failure to retrieve key (no retrial)!')
                            console.error(err);
                        });
                }
            })
            break;
        }
    }

    function getOrCreateCipherMessagesForTrackId(id, type) {
        const hashKey = id + '_' + type;
        if (cipherMessageHash[hashKey]) {
            return cipherMessageHash[hashKey];
        } else {
            const cipherMessages = [];
            cipherMessageHash[hashKey] = cipherMessages;
            return cipherMessages;
        }
    }

    /**
     * @param {string} message
     */
    function onCipherMessage(message) {

        let messageObj;

        // may fail if JSON message data is broken
        try {
            messageObj = JSON.parse(message);
            //console.debug('Parsed received cipher message:', messageObj);
        } catch (err) {
            console.error('Failed to parse JSON:', message);
            console.error(err);
            return;
        }

        try {

            const trackId = messageObj.fragment_info.track_id;
            const codecType = messageObj.fragment_info.codec_type;
            const mediaTimeSecs = messageObj.fragment_info.media_time_secs;

            const cipherMessages
                = getOrCreateCipherMessagesForTrackId(
                    messageObj.fragment_info.track_id,
                    messageObj.fragment_info.codec_type
                );

            cipherMessages.push(messageObj);

            if (cipherMessages.length === 1) {
                console.info(`Received very first cipher message for track ${codecType}_${trackId} at ${mediaTimeSecs} secs`);
            }

        } catch(err) {
            console.error('Fatal error hashing received message:', err);
        }
    }

    function makeSegmentTypeHashkey(mediaType, trackId) {
        return mediaType + '_' + trackId;
    }

    /**
     *
     * @param {Uint8Array} data
     * @param {(Uint8Array) => void} onResult
     */
    function digestFragmentBuffer(data, mediaType, onResult) {

        // parse whole segment with ISO-FF
        let parsedFile = ISOBoxer.parseBuffer(data);

        // check for init data
        const tkhd = parsedFile.fetch('tkhd');
        if (tkhd) {

            // map useful track info to id
            let type;
            if (tkhd.volume === 0 && tkhd.width > 0 && tkhd.height > 0) {
                type = 'video';
            } else if (tkhd.volume > 0 && tkhd.width === 0 && tkhd.height === 0) {
                type = 'audio';
            } else {
                throw new Error('Unable to recognize track type from `tkhd` atom');
                // FIXME: in case necessary, there are unambiguous solutions here
            }

            const timescale = parsedFile.fetch('mdhd').timescale;

            const id = tkhd.track_ID;

            movInitDataHash[makeSegmentTypeHashkey(type, id)] = {
                id,
                timescale,
                type
            };

            // return early, nothing more to do
            onResult(data);
            return;
        }

        // should be a (moof/mdat)s segment, check for traf boxes
        const trafs = parsedFile.fetchAll('traf');
        if (trafs.length === 0) {
            console.warn('Media segment was not init data but has no track fragments');
            console.debug(parsedFile);
            if (DEBUG) debugger;
            onResult(data);
            return;
        }

        const keyMessages = [];

        let isKeyMissing = false;

        for (let index = 0; index < trafs.length; index++) {
            const trafBox = trafs[index];

            // compute track fragment first PTS seconds
            const tfhd = trafBox.boxes[0];
            const tfdt = trafBox.boxes[1];

            const trackId = tfhd.track_ID;
            const firstPts = tfdt.baseMediaDecodeTime;
            const trackInfo = movInitDataHash[makeSegmentTypeHashkey(mediaType, trackId)];
            const firstPtsSeconds = firstPts / trackInfo.timescale;

            // lookup key
            const cipherMessageForBuffer = findCipherMessageByMediaTime(firstPtsSeconds, trackInfo.id, trackInfo.type);

            if (!cipherMessageForBuffer) {
                isKeyMissing = true;
            }
            keyMessages.push(cipherMessageForBuffer);
        }

        if (!isKeyMissing) {
            decryptFragmentBuffer(data, parsedFile, mediaType, onResult);
        } else {
            setTimeout(() => {
                digestFragmentBuffer(data, mediaType, onResult);
            }, DIGEST_RETRY_TIMEOUT_MS);
        }
    }

    function decryptFragmentBuffer(data, parsedFile, mediaType, onResult) {
        const now = perf.now();

        // retrieve all trafs & mdats, lookup key-message by baseMediaDecodeTime
        // and decrypt the payload

        const mdats = parsedFile.fetchAll('mdat');
        const trafs = parsedFile.fetchAll('traf');

        const clearBufferPromises = [];

        for (let index = 0; index < trafs.length; index++) {
            const trafBox = trafs[index];
            const tfhd = trafBox.boxes[0];
            const tfdt = trafBox.boxes[1];

            const trackId = tfhd.track_ID;
            const firstPts = tfdt.baseMediaDecodeTime;
            const trackInfo = movInitDataHash[makeSegmentTypeHashkey(mediaType, trackId)];
            const firstPtsSeconds = firstPts / trackInfo.timescale;

            const cipherMessageForBuffer = findCipherMessageByMediaTime(firstPtsSeconds, trackInfo.id, trackInfo.type);

            // create full key data from short keys
            const keyShort = new Uint32Array([cipherMessageForBuffer.key]);
            const ivShort = new Uint16Array([cipherMessageForBuffer.iv]);
            const key = new Uint8Array(16);
            const iv = new Uint8Array(16);

            key.set(keyShort, 0);
            iv.set(ivShort, 0);

            // decrypt the mdat buffer
            const mdat = mdats[index];
            clearBufferPromises.push(decryptAesCtr(mdat.data, key, iv));
        }

        // awaiting all decrypt promise results ...
        Promise.all(clearBufferPromises).then((clearBuffers) => {
            const decryptTimeMs = perf.now() - now;
            console.log(`Decrypted ${clearBuffers.length} fragment buffers in ${decryptTimeMs.toFixed(3)} ms`);
            // TODO: write results back into original downloaded segment data here
            onResult(data);
        });
    }

    /**
     * @param {number} lookupMediaTimeSecs
     * @returns {ExmgCipherMessage}
     */
    function findCipherMessageByMediaTime(lookupMediaTimeSecs, trackId, trackType) {
        const cipherMessages = getOrCreateCipherMessagesForTrackId(trackId, trackType);

        let matchMsg = null;
        for (let index = 0; index < cipherMessages.length; index++) {
            const msg = cipherMessages[index];
            try {
                const keyFirstPtsSeconds = msg.fragment_info.media_time_secs; // corresponds to first PTS for that key
                const keyBoundaryPtsSecs = keyFirstPtsSeconds + msg.key_max_duration_secs; // key-scope boundary
                if (lookupMediaTimeSecs >= keyFirstPtsSeconds && lookupMediaTimeSecs < keyBoundaryPtsSecs) {
                    matchMsg = msg;
                    break;
                }
            } catch(err) {
                console.error('Error accessing key-message data:', err.message);
            }
        }
        if (!matchMsg) {
            //console.warn('key not found for fragment')
        }
        return matchMsg;
    }

    function createMqttSubscribeClient(onMessage) {

        if (clientCreated) {
            throw new Error('MQTT client create function shall only be called once');
        }

        console.info('EXMG MQTT:', 'connecting MQTT subscribe');

        const host = MQTT_HOST;
        const options = {
            keepalive: 10,
            protocolId: 'MQTT',
            protocolVersion: 4,
            clean: true,
            reconnectPeriod: 1000,
            connectTimeout: 30*1000,
            clientId: MQTT_CLIENT_ID
        };

        if (!window.mqtt) {
            throw new Error('`mqtt` is not available in window scope');
        }

        const client = window.mqtt.connect(host, options);
        client.on('connect', function () {
            // FIXME: handle/retry initial connection/sub failures
            client.subscribe(MQTT_TOPIC, function (err) {
                if (err)
                    console.error('EXMG MQTT:', 'subscribe error: ' + err);
                else
                    console.info('EXMG MQTT:', 'subscribed');
            });
        });
        client.on('message', function (topic, message) {
            onMessage(message.toString());
        });
        clientCreated = true;
        return client;
    }

    // FIXME: destroy client when player terminates session
    function disposeMqttSubClient() {

    }

    instance = {
        mqttClient,
        digestFragmentBuffer
    };

    return instance;
}
