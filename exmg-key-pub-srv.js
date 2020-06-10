#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mkdirp = require('mkdirp')
const app = express();
const port = 3002;

const PUB_DIR = 'public';

// @see https://github.com/expressjs/cors#configuring-cors
app.use(cors(/* specific config here */)); // <--- CORS-requests support
// enable pre-flight across-the-board
app.options("*", cors()); // @see https://github.com/expressjs/cors#enabling-cors-pre-flight

//app.use(express.json({type: 'application/json'}));
app.use(bodyParser.text({type: 'text/plain'}));
app.use(bodyParser.text({type: 'application/json'}));

app.use(express.static(PUB_DIR));

app.post('/*', function(request, response) {

    console.log(request.path)
    console.log(request.body);

    const data = request.body;

    const fileOutPath = path.resolve(PUB_DIR + request.path);

    mkdirp(path.dirname(fileOutPath)).then(() => {

        fs.writeFile(fileOutPath, data, {flag: 'w'}, (err) => {

            if (err) {
                console.error('Failure writing file:', err.message);
                response.writeHead(500, err.message);
                response.write('ERROR: ' + err.message);
                response.end();
                return;
            }

            response.writeHead(200);
            response.write('OK');
            response.end();

        });

    });

});

app.listen(port, () => {
    console.log('Ready on port:', port);
});
