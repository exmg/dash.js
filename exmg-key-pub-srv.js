const express = require('express');
const app = express();

app.use(express.json());

app.post('/*', function(request, response){
    console.log(request.body);      // your JSON
    response.send(request.body);    // echo the result back
});

app.listen(3001);
