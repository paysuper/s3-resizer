'use strict';

// this file is for lambda function used in API GateWay for image resize.

//https://rlmjh6knp1.execute-api.eu-west-1.amazonaws.com/prod/img-resize-api/?path=/100x101/4.jpg

const AWS = require('aws-sdk');
const S3 = new AWS.S3({signatureVersion: 'v4'});
const Sharp = require('sharp');
const {URLSearchParams} = require('url');
// parameters
//const BUCKET = "cdn.pay.super.com"
const {BUCKET, URL, ROOT_KEY_PREFIX, RSZ_SUBKEY, ERROR_URL} = process.env;

exports.handler = function(event, _context, callback) {
    //var path = event.path;
    //const urlParams = new URLSearchParams(s);
    //console.log(urlParams.get('source_bucket'))

    console.log('Request event: '+JSON.stringify(event));    

    var params = new URLSearchParams(decodeURIComponent(event.queryStringParameters.params));
    console.log('params: ', params);
    
    //var path = event.queryStringParameters.path;
    var path = params.get('path');

    var sourceBucket = params.get('source_bucket');
    if(!sourceBucket){        
        sourceBucket = BUCKET;
    }
    
    var redirDomain = params.get('redir_domain');
    if(!redirDomain){
        redirDomain = URL;
    }

    var rootKeyPrefix=params.get('key_prefix');
    if(!rootKeyPrefix){
        rootKeyPrefix = ROOT_KEY_PREFIX;
    }

    console.log('Request path: '+path);
    console.log(`Source bucket: ${sourceBucket}`);
    console.log(`Redirect to domain: ${redirDomain}`);
    console.log(`Key prefix: ${rootKeyPrefix}`);

    const PathPattern = new RegExp(`/(${rootKeyPrefix}/)${RSZ_SUBKEY}/(.*)/(.*)`);

    var parts = PathPattern.exec(`/${rootKeyPrefix}/${RSZ_SUBKEY}${path}`);
    if(!parts) {
        callback(null, {
            statusCode: 404,
            body: 'wrong path',
            headers: {"Content-Type": "text/plain"}
        });
        return;
    }
    var dir = parts[1] || '';
    var options = parts[2].split('_');
    var filename = parts[3];
    var resizedKey = dir + `${RSZ_SUBKEY}/`+parts[2]+'/'+filename;

    var sizes = options[0].split("x");
    var action = options.length > 1 ? options[1] : null;

    if (action && action !== 'max' && action !== 'min') {
        console.log("Unknown func parameter");
        callback(null, {
            statusCode: 400,
            body: `Unknown func parameter "${action}"\n` +
                'For query ".../150x150_func", "_func" must be either empty, "_min" or "_max"',
            headers: {"Content-Type": "text/plain"}
        });
        return;
    }

    console.log('Dir: '+dir+', File name: '+filename);
    console.log('resizedKey: '+resizedKey);

    var contentType;
    S3.getObject({Bucket: sourceBucket, Key: dir + filename})
        .promise()
        .then(data => {
                console.log("Get original file - SUCCESS");
                contentType = data.ContentType;
                var width = sizes[0] === 'AUTO' ? null : parseInt(sizes[0]);
                var height = sizes[1] === 'AUTO' ? null : parseInt(sizes[1]);
                var fit;
                switch (action) {
                    case 'max':
                        fit = 'inside';
                        break;
                    case 'min':
                        fit = 'outside';
                        break;
                    default:
                        fit = 'contain';
                        break;
                }
                var options = {
                    withoutEnlargement: false,
                    fit,
                    background: {r: 0, g: 0, b: 0, alpha: 0}
                };
                var image = Sharp(data.Body);
                return image
                    .resize(width, height, options)
                    .jpeg({ quality: 85, force: false })
                    .png({ compressionLevel: 9, force: false })
                    .rotate()
                    .toBuffer();
            },
            error => {
                console.log('Failed to get original file from S3');
                callback(null, {
                    statusCode: 301,
                    headers: {"Location" : `${ERROR_URL}`}                    
                    // statusCode: 404,
                    // body: 'not found',
                    // headers: {"Content-Type": "text/plain"}
                });
                return Promise.reject('Failed to get original file from S3');
            }
        )
        .then(result => {
            console.log("Put resized file to S3");
            S3.putObject({
                Body: result,
                Bucket: sourceBucket,
                ContentType: contentType,
                Key: resizedKey
            }).promise() ;
        }, error => {
            console.log('Failed to resize: ',error);
            return Promise.reject('Failed to resize image');
        })
        .then(() => {
            console.log("Put success");
            callback(null, {
                statusCode: 301,
                headers: {"Location" : `https://${redirDomain}/${resizedKey}`}
            })},
            error => {
                console.log('Put failed: ', error);
                return Promise.reject('Failed to put resized image to S3');
            }
        )
        .catch(e => {
            console.log('Exception: ' + e.message);
            callback(null, {
                statusCode: e.statusCode || 400,
                body: 'Exception: ' + e.message,
                headers: {"Content-Type": "text/plain"}
            });
        });
};
