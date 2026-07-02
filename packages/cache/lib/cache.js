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
exports.ReserveCacheError = exports.ValidationError = void 0;
exports.isFeatureAvailable = isFeatureAvailable;
exports.restoreCache = restoreCache;
exports.saveCache = saveCache;
const core = __importStar(require("@actions/core"));
const path = __importStar(require("path"));
const utils = __importStar(require("./internal/cacheUtils"));
const cacheHttpClient = __importStar(require("./internal/cacheHttpClient"));
const tar_1 = require("./internal/tar");
class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        Object.setPrototypeOf(this, ValidationError.prototype);
    }
}
exports.ValidationError = ValidationError;
class ReserveCacheError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ReserveCacheError';
        Object.setPrototypeOf(this, ReserveCacheError.prototype);
    }
}
exports.ReserveCacheError = ReserveCacheError;
function checkPaths(paths) {
    if (!paths || paths.length === 0) {
        throw new ValidationError(`Path Validation Error: At least one directory or file path is required`);
    }
}
function checkKey(key) {
    if (key.length > 512) {
        throw new ValidationError(`Key Validation Error: ${key} cannot be larger than 512 characters.`);
    }
    const regex = /^[^,]*$/;
    if (!regex.test(key)) {
        throw new ValidationError(`Key Validation Error: ${key} cannot contain commas.`);
    }
}
/**
 * isFeatureAvailable to check the presence of Actions cache service
 *
 * @returns boolean return true if Actions cache service feature is available, otherwise false
 */
function isFeatureAvailable() {
    return !!process.env['ACTIONS_CACHE_URL'];
}
/**
 * Restores cache from keys
 *
 * @param paths a list of file paths to restore from the cache
 * @param primaryKey an explicit key for restoring the cache
 * @param restoreKeys an optional ordered list of keys to use for restoring the cache if no cache hit occurred for key
 * @param options cache download options
 * @param enableCrossOsArchive an optional boolean enabled to restore on windows any cache created on any platform
 * @param s3Options upload options for AWS S3
 * @param s3BucketName a name of AWS S3 bucket
 * @returns string returns the key for the cache hit, otherwise returns undefined
 */
async function restoreCache(paths, primaryKey, restoreKeys, options, enableCrossOsArchive = false, s3Options, s3BucketName) {
    checkPaths(paths);
    restoreKeys = restoreKeys || [];
    const keys = [primaryKey, ...restoreKeys];
    core.debug('Resolved Keys:');
    core.debug(JSON.stringify(keys));
    if (keys.length > 10) {
        throw new ValidationError(`Key Validation Error: Keys are limited to a maximum of 10.`);
    }
    for (const key of keys) {
        checkKey(key);
    }
    const compressionMethod = await utils.getCompressionMethod();
    let archivePath = '';
    try {
        // path are needed to compute version
        const cacheEntry = await cacheHttpClient.getCacheEntry(keys, paths, {
            compressionMethod,
            enableCrossOsArchive
        }, s3Options, s3BucketName);
        if (!cacheEntry?.archiveLocation) {
            // Cache not found
            return undefined;
        }
        if (options?.lookupOnly) {
            core.info('Lookup only - skipping download');
            return cacheEntry.cacheKey;
        }
        archivePath = path.join(await utils.createTempDirectory(), utils.getCacheFileName(compressionMethod));
        core.debug(`Archive Path: ${archivePath}`);
        // Download the cache from the cache entry
        await cacheHttpClient.downloadCache(cacheEntry, archivePath, options, s3Options, s3BucketName);
        if (core.isDebug()) {
            await (0, tar_1.listTar)(archivePath, compressionMethod);
        }
        const archiveFileSize = utils.getArchiveFileSizeInBytes(archivePath);
        core.info(`Cache Size: ~${Math.round(archiveFileSize / (1024 * 1024))} MB (${archiveFileSize} B)`);
        await (0, tar_1.extractTar)(archivePath, compressionMethod);
        core.info('Cache restored successfully');
        return cacheEntry.cacheKey;
    }
    catch (error) {
        const typedError = error;
        if (typedError.name === ValidationError.name) {
            throw error;
        }
        else {
            // Supress all non-validation cache related errors because caching should be optional
            core.warning(`Failed to restore: ${error.message}`);
        }
    }
    finally {
        // Try to delete the archive to save space
        try {
            await utils.unlinkFile(archivePath);
        }
        catch (error) {
            core.debug(`Failed to delete archive: ${error}`);
        }
    }
    return undefined;
}
/**
 * Saves a list of files with the specified key
 *
 * @param paths a list of file paths to be cached
 * @param key an explicit key for restoring the cache
 * @param enableCrossOsArchive an optional boolean enabled to save cache on windows which could be restored on any platform
 * @param options cache upload options
 * @param s3Options upload options for AWS S3
 * @param s3BucketName a name of AWS S3 bucket
 * @returns number returns cacheId if the cache was saved successfully and throws an error if save fails
 */
async function saveCache(paths, key, options, enableCrossOsArchive = false, s3Options, s3BucketName) {
    checkPaths(paths);
    checkKey(key);
    const compressionMethod = await utils.getCompressionMethod();
    let cacheId = -1;
    const cachePaths = await utils.resolvePaths(paths);
    core.debug('Cache Paths:');
    core.debug(`${JSON.stringify(cachePaths)}`);
    if (cachePaths.length === 0) {
        throw new Error(`Path Validation Error: Path(s) specified in the action for caching do(es) not exist, hence no cache is being saved.`);
    }
    const archiveFolder = await utils.createTempDirectory();
    const archivePath = path.join(archiveFolder, utils.getCacheFileName(compressionMethod));
    core.debug(`Archive Path: ${archivePath}`);
    try {
        await (0, tar_1.createTar)(archiveFolder, cachePaths, compressionMethod);
        if (core.isDebug()) {
            await (0, tar_1.listTar)(archivePath, compressionMethod);
        }
        const fileSizeLimit = 10 * 1024 * 1024 * 1024; // 10GB per repo limit
        const archiveFileSize = utils.getArchiveFileSizeInBytes(archivePath);
        core.debug(`File Size: ${archiveFileSize}`);
        // For GHES, this check will take place in ReserveCache API with enterprise file size limit
        if (archiveFileSize > fileSizeLimit && !utils.isGhes()) {
            throw new Error(`Cache size of ~${Math.round(archiveFileSize / (1024 * 1024))} MB (${archiveFileSize} B) is over the 10GB limit, not saving cache.`);
        }
        if (!(s3Options && s3BucketName)) {
            core.debug('Reserving Cache');
            const reserveCacheResponse = await cacheHttpClient.reserveCache(key, paths, {
                compressionMethod,
                enableCrossOsArchive,
                cacheSize: archiveFileSize
            }, s3Options, s3BucketName);
            if (reserveCacheResponse?.result?.cacheId) {
                cacheId = reserveCacheResponse?.result?.cacheId;
            }
            else if (reserveCacheResponse?.statusCode === 400) {
                throw new Error(reserveCacheResponse?.error?.message ??
                    `Cache size of ~${Math.round(archiveFileSize / (1024 * 1024))} MB (${archiveFileSize} B) is over the data cap limit, not saving cache.`);
            }
            else {
                throw new ReserveCacheError(`Unable to reserve cache with key ${key}, another job may be creating this cache. More details: ${reserveCacheResponse?.error?.message}`);
            }
        }
        core.debug(`Saving Cache (ID: ${cacheId})`);
        await cacheHttpClient.saveCache(cacheId, archivePath, key, options, s3Options, s3BucketName);
    }
    catch (error) {
        const typedError = error;
        if (typedError.name === ValidationError.name) {
            throw error;
        }
        else if (typedError.name === ReserveCacheError.name) {
            core.info(`Failed to save: ${typedError.message}`);
        }
        else {
            core.warning(`Failed to save: ${typedError.message}`);
        }
    }
    finally {
        // Try to delete the archive to save space
        try {
            await utils.unlinkFile(archivePath);
        }
        catch (error) {
            core.debug(`Failed to delete archive: ${error}`);
        }
    }
    return cacheId;
}
//# sourceMappingURL=cache.js.map