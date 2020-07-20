import json
import datetime
import boto3
import PIL
from PIL import Image
from io import BytesIO
import os
import re

from PIL import Image
from resizeimage import resizeimage


def resizer(event, context):

    request = event['Records'][0]['cf']['request'];
    #print(request)
    parts = re.search('/(.+)/rsz/(.+x.+)(/.*)$',request['uri'])
    if not parts:
        return request
        
    srcObjectPath = parts.group(1)+parts.group(3)
    dstObjectPath = re.search('/(.+)', request['uri']).group(1);
    print('srcObjectPath: '+srcObjectPath)
    print('dstObjectPath: '+dstObjectPath)
    
    sourceBucket = request['origin']['s3']['domainName'].replace('.s3.amazonaws.com','');
    print('sourceBucket: ' + sourceBucket)

    options = parts.group(2).split('_')  # e.g. "150x150_max"
    sizes = options[0].split("x");
    print('sizes: '+sizes[0] + 'x'+sizes[1])
    if len(options) > 1:
        action = options[1] 
        print('action: '+action);
    else: 
        action = None;    

    if action and action != 'max' and action != 'min':
        print("Unknown func parameter");
        return {
             'status': 400,
             'body': 'Unknown func parameter "'+action+'"\n' +
                 'For query ".../150x150_func", "_func" must be either empty, "_min" or "_max"',
             'headers': {'content-type': [{'key': 'Content-Type', 'value': 'text/html; charset=utf-8'}]}
        }

    s3 = boto3.client('s3')
    try:
        headResult = s3.head_object(Bucket=sourceBucket, Key=dstObjectPath)
    except Exception as e: 
        headResult = None
    if headResult:
        print('Resized file exists')
        return request
    
    srcObj = s3.get_object(Bucket=sourceBucket, Key=srcObjectPath)
    if srcObj:
        contentType = srcObj['ContentType']
        print('contentType: '+contentType)
        srcBody = srcObj['Body'].read()
        img = Image.open(BytesIO(srcBody))
        format = img.format
        print('format: '+format)
        img = resizeimage.resize_contain(img, [int(sizes[0]), int(sizes[1])], bg_color=(0, 0, 0, 0)) #PIL.Image.ANTIALIAS)
        if format == 'JPEG':
            fill_color='black'
            background = Image.new(img.mode[:-1], img.size, fill_color)
            background.paste(img, img.split()[-1])
            img = background            
        if not img:
            print('failed to resize')
            return request
        buffer = BytesIO()
        img.save(buffer, format)
        buffer.seek(0)
        obj = s3.put_object(Bucket = sourceBucket, Key = dstObjectPath, Body = buffer, ContentType = contentType)
        return request
