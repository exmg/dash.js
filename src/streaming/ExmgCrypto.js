/**
 * @param {Uint8Array} cipherData Encrypted data buffer
 * @param {Uint8Array} key 16-bytes (128 bits) key
 * @param {Uint8Array} iv 8 bytes (64 bits) IV zero-padded in start of 16-bytes buffer
 * @returns {Promise<Uint8Array>}
 */
export function decryptBufferFromAesCtr(cipherData, key, iv) {

    if (key.byteLength !== 16) throw new Error('Key must be 128 bits');
    if (iv.byteLength !== 16) throw new Error('8-bytes IV must be padded in 128 bits CTR data');

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
                length: 64 // we use an 8-byte IV
            },
            keyObj,
            cipherData
        )
        .then((clearData) => {
            return new Uint8Array(clearData);
        })
        .catch((err) => {
            console.error('Error decrypting AES-CTR cipherdata: ' + err.message);
        });
    });
}
