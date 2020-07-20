'use strict';

const AWS = require('aws-sdk');
const S3 = new AWS.S3({signatureVersion: 'v4'});
const Sharp = require('sharp');

const DEBUG = false;

exports.handler = function(event, _context, callback) {

    const request = event.Records[0].cf.request;
    if(DEBUG){
        console.log('Request event: '+JSON.stringify(event));
    }

    const PathPattern = new RegExp('/(.+)/rsz/(.+x.+)(/.*)$');
    var parts = PathPattern.exec(request.uri);
    if(DEBUG){
        console.log(parts);
    }
    
    if(!parts) {
        callback(null, request);
        return;
    }

    var sourceBucket = request.origin.s3.domainName.replace(/\.s3\.amazonaws\.com/,'');
    console.log('source bucket: '+sourceBucket);    
    
    const srcObjectPath = parts[1]+parts[3];
    const dstObjectPath = request.uri.replace(/^\//,'');
    console.log('srcObjectPath: '+srcObjectPath + ', dstObjectPath: '+dstObjectPath);
    
    const options = parts[2].split('_');  // e.g. "150x150_max"
    const sizes = options[0].split("x");
    const action = options.length > 1 ? options[1] : null;    
    console.log('action: '+action + ' sizes: '+sizes);

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
    
    S3.headObject({Bucket: sourceBucket, Key: dstObjectPath})
        .promise()
        .then(data => {
                console.log('Resized file exists');
                callback(null, request)
            },
            error => {
                var contentType;
                S3.getObject({Bucket: sourceBucket, Key: srcObjectPath})
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
                            console.log('Failed to get original file from S3', error);
                            callback(null, request);
                            return Promise.reject('Failed to get original file from S3');
                        }
                    )
                    .then(result => {
                        console.log("Put resized file to S3");
                        return S3.putObject({
                            Body: result,
                            Bucket: sourceBucket,
                            ContentType: contentType,
                            Key: dstObjectPath
                        }).promise() ;
                    }, error => {
                        console.log('Failed to resize: ',error);
                        return Promise.reject('Failed to resize image');
                    })
                    .then(() => {
                        console.log("Put success");
                        callback(null, request)},
                        error => {
                            console.log('Put failed: ', error);
                            return Promise.reject('Failed to put resized image to S3');
                        }
                    )
                    .catch(e => {
                        console.log('Exception: ' + e.message);
                        callback(null, request);
                    });                
            }
        )
    

};
