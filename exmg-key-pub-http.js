#!/usr/bin/env node

const fs = require('fs');
const http = require('http')
const https = require('https')
const path = require('path')

const phin = require('phin')

const remoteStreamId = 664379;
const remoteEventName = 'stephan'

const remoteHost = `p-ep${remoteStreamId}.i.akamaientrypoint.net`;
const remoteBasePath = `/cmaf/live/${remoteStreamId}/${remoteEventName}/`;

const dirPath = path.resolve(process.argv[2]);

const JOB_POLL_MS = 1000;

function doHttpPost(hostname, path, data, mimeType) {
    return phin({
        url: 'https://' + hostname + path,
        method: 'POST',
        data,
        core: {
            headers: {
                'Content-Type': mimeType
            }
        }
    })
}

function getDirFilesListing(dir) {
    return new Promise((resolve, reject) => {
        // list all files in the directory
        fs.readdir(dir, (err, files) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(files)
        });
    })
}

function readFile(path) {
    return new Promise((res, rej) => {
        fs.readFile(path, (err, buf) => {
            if (err) {
                rej(err);
                return;
            }
            res(buf);
        })
    })
}

function writeLockFile(path) {
    return new Promise((res, rej) => {
        fs.writeFile(path + '.lock', null, res);
    });
}

function scanAndPublish() {
    let filesList;
    return getDirFilesListing(dirPath).then((files) => {

        files = files.filter((f) => ! f.endsWith('.lock'));

        filesList = files;
        console.log('Scanned files:', files)
        return Promise.all(files.map((filename) => {
            console.log('reading file:', filename)
            return readFile(path.join(dirPath, filename))
        }))
    }).then((bufferList) => {
        console.log('Read buffers:', bufferList.length)
        return Promise.all(bufferList.map((buf, index) => {
            const filename = filesList[index];
            const remoteFilePath = remoteBasePath + filename;
            //const mimeType = filename.endsWith('.json') ? 'application/json' : 'text/plain';

            const mimeType = 'video/mp4';

            console.log('Doing POST request:', filename, remoteHost, remoteFilePath, mimeType)

            return doHttpPost(remoteHost, remoteFilePath, buf, mimeType)
                .then((res) => {
                    console.log('Done POST:', remoteFilePath)
                    console.log('Server response:', res.body.toString('utf8'))
                })
                .then(() => writeLockFile(path.resolve(dirPath, filename)))
        }))
    })
}

(function main() {

    /*
    let idle = true;
    setInterval(() => {
        // check for async lock
        if (!idle) return;
        idle = false;

        scanAndPublish().then(() => {
            idle = true;
            scanAndPublish();
        }).catch((err) => {
            console.error('[EXMG KEY-PUB] Caught fatal:', err);
            process.exit(1);
        })

    }, JOB_POLL_MS)
    */

   scanAndPublish().then(() => {
        scanAndPublish();
    }).catch((err) => {
        console.error('[EXMG KEY-PUB] Caught fatal:', err);
        process.exit(1);
    })

})();
