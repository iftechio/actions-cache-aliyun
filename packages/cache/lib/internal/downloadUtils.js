"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DownloadProgress = void 0;
exports.downloadCacheHttpClient = downloadCacheHttpClient;
exports.downloadCacheHttpClientConcurrent = downloadCacheHttpClientConcurrent;
exports.downloadCacheStorageSDK = downloadCacheStorageSDK;
exports.downloadCacheStorageS3 = downloadCacheStorageS3;
const core = __importStar(require("@actions/core"));
const http_client_1 = require("@actions/http-client");
const storage_blob_1 = require("@azure/storage-blob");
const client_s3_1 = require("@aws-sdk/client-s3");
const buffer = __importStar(require("buffer"));
const fs = __importStar(require("fs"));
const stream = __importStar(require("stream"));
const util = __importStar(require("util"));
const utils = __importStar(require("./cacheUtils"));
const constants_1 = require("./constants");
const requestUtils_1 = require("./requestUtils");
/**
 * Pipes the body of a HTTP response to a stream
 *
 * @param response the HTTP response
 * @param output the writable stream
 */
async function pipeResponseToStream(response, output) {
    const pipeline = util.promisify(stream.pipeline);
    await pipeline(response.message, output);
}
/**
 * Class for tracking the download state and displaying stats.
 */
class DownloadProgress {
    contentLength;
    segmentIndex;
    segmentSize;
    segmentOffset;
    receivedBytes;
    startTime;
    displayedComplete;
    timeoutHandle;
    constructor(contentLength) {
        this.contentLength = contentLength;
        this.segmentIndex = 0;
        this.segmentSize = 0;
        this.segmentOffset = 0;
        this.receivedBytes = 0;
        this.displayedComplete = false;
        this.startTime = Date.now();
    }
    /**
     * Progress to the next segment. Only call this method when the previous segment
     * is complete.
     *
     * @param segmentSize the length of the next segment
     */
    nextSegment(segmentSize) {
        this.segmentOffset = this.segmentOffset + this.segmentSize;
        this.segmentIndex = this.segmentIndex + 1;
        this.segmentSize = segmentSize;
        this.receivedBytes = 0;
        core.debug(`Downloading segment at offset ${this.segmentOffset} with length ${this.segmentSize}...`);
    }
    /**
     * Sets the number of bytes received for the current segment.
     *
     * @param receivedBytes the number of bytes received
     */
    setReceivedBytes(receivedBytes) {
        this.receivedBytes = receivedBytes;
    }
    /**
     * Returns the total number of bytes transferred.
     */
    getTransferredBytes() {
        return this.segmentOffset + this.receivedBytes;
    }
    /**
     * Returns true if the download is complete.
     */
    isDone() {
        return this.getTransferredBytes() === this.contentLength;
    }
    /**
     * Prints the current download stats. Once the download completes, this will print one
     * last line and then stop.
     */
    display() {
        if (this.displayedComplete) {
            return;
        }
        const transferredBytes = this.segmentOffset + this.receivedBytes;
        const percentage = (100 * (transferredBytes / this.contentLength)).toFixed(1);
        const elapsedTime = Date.now() - this.startTime;
        const downloadSpeed = (transferredBytes /
            (1024 * 1024) /
            (elapsedTime / 1000)).toFixed(1);
        core.info(`Received ${transferredBytes} of ${this.contentLength} (${percentage}%), ${downloadSpeed} MBs/sec`);
        if (this.isDone()) {
            this.displayedComplete = true;
        }
    }
    /**
     * Returns a function used to handle TransferProgressEvents.
     */
    onProgress() {
        return (progress) => {
            this.setReceivedBytes(progress.loadedBytes);
        };
    }
    /**
     * Starts the timer that displays the stats.
     *
     * @param delayInMs the delay between each write
     */
    startDisplayTimer(delayInMs = 1000) {
        const displayCallback = () => {
            this.display();
            if (!this.isDone()) {
                this.timeoutHandle = setTimeout(displayCallback, delayInMs);
            }
        };
        this.timeoutHandle = setTimeout(displayCallback, delayInMs);
    }
    /**
     * Stops the timer that displays the stats. As this typically indicates the download
     * is complete, this will display one last line, unless the last line has already
     * been written.
     */
    stopDisplayTimer() {
        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = undefined;
        }
        this.display();
    }
}
exports.DownloadProgress = DownloadProgress;
/**
 * Download the cache using the Actions toolkit http-client
 *
 * @param archiveLocation the URL for the cache
 * @param archivePath the local path where the cache is saved
 */
async function downloadCacheHttpClient(archiveLocation, archivePath) {
    const writeStream = fs.createWriteStream(archivePath);
    const httpClient = new http_client_1.HttpClient('actions/cache');
    const downloadResponse = await (0, requestUtils_1.retryHttpClientResponse)('downloadCache', async () => httpClient.get(archiveLocation));
    // Abort download if no traffic received over the socket.
    downloadResponse.message.socket.setTimeout(constants_1.SocketTimeout, () => {
        downloadResponse.message.destroy();
        core.debug(`Aborting download, socket timed out after ${constants_1.SocketTimeout} ms`);
    });
    await pipeResponseToStream(downloadResponse, writeStream);
    // Validate download size.
    const contentLengthHeader = downloadResponse.message.headers['content-length'];
    if (contentLengthHeader) {
        const expectedLength = parseInt(contentLengthHeader);
        const actualLength = utils.getArchiveFileSizeInBytes(archivePath);
        if (actualLength !== expectedLength) {
            throw new Error(`Incomplete download. Expected file size: ${expectedLength}, actual file size: ${actualLength}`);
        }
    }
    else {
        core.debug('Unable to validate download, no Content-Length header');
    }
}
/**
 * Download the cache using the Actions toolkit http-client concurrently
 *
 * @param archiveLocation the URL for the cache
 * @param archivePath the local path where the cache is saved
 */
async function downloadCacheHttpClientConcurrent(archiveLocation, archivePath, options) {
    const archiveDescriptor = await fs.promises.open(archivePath, 'w');
    const httpClient = new http_client_1.HttpClient('actions/cache', undefined, {
        socketTimeout: options.timeoutInMs,
        keepAlive: true
    });
    try {
        const res = await (0, requestUtils_1.retryHttpClientResponse)('downloadCacheMetadata', async () => await httpClient.request('HEAD', archiveLocation, null, {}));
        const lengthHeader = res.message.headers['content-length'];
        if (lengthHeader === undefined || lengthHeader === null) {
            throw new Error('Content-Length not found on blob response');
        }
        const length = parseInt(lengthHeader);
        if (Number.isNaN(length)) {
            throw new Error(`Could not interpret Content-Length: ${length}`);
        }
        const downloads = [];
        const blockSize = 4 * 1024 * 1024;
        for (let offset = 0; offset < length; offset += blockSize) {
            const count = Math.min(blockSize, length - offset);
            downloads.push({
                offset,
                promiseGetter: async () => {
                    return await downloadSegmentRetry(httpClient, archiveLocation, offset, count);
                }
            });
        }
        // reverse to use .pop instead of .shift
        downloads.reverse();
        let actives = 0;
        let bytesDownloaded = 0;
        const progress = new DownloadProgress(length);
        progress.startDisplayTimer();
        const progressFn = progress.onProgress();
        const activeDownloads = [];
        let nextDownload;
        const waitAndWrite = async () => {
            const segment = await Promise.race(Object.values(activeDownloads));
            await archiveDescriptor.write(segment.buffer, 0, segment.count, segment.offset);
            actives--;
            delete activeDownloads[segment.offset];
            bytesDownloaded += segment.count;
            progressFn({ loadedBytes: bytesDownloaded });
        };
        while ((nextDownload = downloads.pop())) {
            activeDownloads[nextDownload.offset] = nextDownload.promiseGetter();
            actives++;
            if (actives >= (options.downloadConcurrency ?? 10)) {
                await waitAndWrite();
            }
        }
        while (actives > 0) {
            await waitAndWrite();
        }
    }
    finally {
        httpClient.dispose();
        await archiveDescriptor.close();
    }
}
async function downloadSegmentRetry(httpClient, archiveLocation, offset, count) {
    const retries = 5;
    let failures = 0;
    while (true) {
        try {
            const timeout = 30000;
            const result = await promiseWithTimeout(timeout, downloadSegment(httpClient, archiveLocation, offset, count));
            if (typeof result === 'string') {
                throw new Error('downloadSegmentRetry failed due to timeout');
            }
            return result;
        }
        catch (err) {
            if (failures >= retries) {
                throw err;
            }
            failures++;
        }
    }
}
async function downloadSegment(httpClient, archiveLocation, offset, count) {
    const partRes = await (0, requestUtils_1.retryHttpClientResponse)('downloadCachePart', async () => await httpClient.get(archiveLocation, {
        Range: `bytes=${offset}-${offset + count - 1}`
    }));
    if (!partRes.readBodyBuffer) {
        throw new Error('Expected HttpClientResponse to implement readBodyBuffer');
    }
    return {
        offset,
        count,
        buffer: await partRes.readBodyBuffer()
    };
}
/**
 * Download the cache using the Azure Storage SDK.  Only call this method if the
 * URL points to an Azure Storage endpoint.
 *
 * @param archiveLocation the URL for the cache
 * @param archivePath the local path where the cache is saved
 * @param options the download options with the defaults set
 */
async function downloadCacheStorageSDK(archiveLocation, archivePath, options) {
    const client = new storage_blob_1.BlockBlobClient(archiveLocation, undefined, {
        retryOptions: {
            // Override the timeout used when downloading each 4 MB chunk
            // The default is 2 min / MB, which is way too slow
            tryTimeoutInMs: options.timeoutInMs
        }
    });
    const properties = await client.getProperties();
    const contentLength = properties.contentLength ?? -1;
    if (contentLength < 0) {
        // We should never hit this condition, but just in case fall back to downloading the
        // file as one large stream
        core.debug('Unable to determine content length, downloading file with http-client...');
        await downloadCacheHttpClient(archiveLocation, archivePath);
    }
    else {
        // Use downloadToBuffer for faster downloads, since internally it splits the
        // file into 4 MB chunks which can then be parallelized and retried independently
        //
        // If the file exceeds the buffer maximum length (~1 GB on 32-bit systems and ~2 GB
        // on 64-bit systems), split the download into multiple segments
        // ~2 GB = 2147483647, beyond this, we start getting out of range error. So, capping it accordingly.
        // Updated segment size to 128MB = 134217728 bytes, to complete a segment faster and fail fast
        const maxSegmentSize = Math.min(134217728, buffer.constants.MAX_LENGTH);
        const downloadProgress = new DownloadProgress(contentLength);
        const fd = fs.openSync(archivePath, 'w');
        try {
            downloadProgress.startDisplayTimer();
            const controller = new AbortController();
            const abortSignal = controller.signal;
            while (!downloadProgress.isDone()) {
                const segmentStart = downloadProgress.segmentOffset + downloadProgress.segmentSize;
                const segmentSize = Math.min(maxSegmentSize, contentLength - segmentStart);
                downloadProgress.nextSegment(segmentSize);
                const result = await promiseWithTimeout(options.segmentTimeoutInMs || 3600000, client.downloadToBuffer(segmentStart, segmentSize, {
                    abortSignal,
                    concurrency: options.downloadConcurrency,
                    onProgress: downloadProgress.onProgress()
                }));
                if (result === 'timeout') {
                    controller.abort();
                    throw new Error('Aborting cache download as the download time exceeded the timeout.');
                }
                else if (Buffer.isBuffer(result)) {
                    fs.writeFileSync(fd, result);
                }
            }
        }
        finally {
            downloadProgress.stopDisplayTimer();
            fs.closeSync(fd);
        }
    }
}
/**
 * Download the cache using the AWS S3.  Only call this method if the use S3.
 *
 * @param key the key for the cache in S3
 * @param archivePath the local path where the cache is saved
 * @param s3Options: the option for AWS S3 client
 * @param s3BucketName: the name of bucket in AWS S3
 */
async function downloadCacheStorageS3(key, archivePath, s3Options, s3BucketName) {
    const s3client = new client_s3_1.S3Client(s3Options);
    const param = {
        Bucket: s3BucketName,
        Key: key
    };
    const response = await s3client.send(new client_s3_1.GetObjectCommand(param));
    if (!response.Body) {
        throw new Error(`Incomplete download. response.Body is undefined from S3.`);
    }
    const fileStream = fs.createWriteStream(archivePath);
    const pipeline = util.promisify(stream.pipeline);
    await pipeline(response.Body, fileStream);
    return;
}
const promiseWithTimeout = async (timeoutMs, promise) => {
    let timeoutHandle;
    const timeoutPromise = new Promise(resolve => {
        timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).then(result => {
        clearTimeout(timeoutHandle);
        return result;
    });
};
//# sourceMappingURL=downloadUtils.js.map