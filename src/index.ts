import { createFilter,  } from '@rollup/pluginutils';
import { basename, extname } from 'path';

const chalk = require('chalk');
const sha1 = require('sha1');
const sass = require('sass');

interface Options {
    include: string[] | RegExp[];
    exclude: string[];
    includePaths: string[];
}

const defaultOptions = {
    include: [/\.s?(a|c)ss$/],
    exclude: [],
    includePaths: [],
};

const stylesheets = new Map();
const hashLength = 8;

const transpile = (scss, path, options) => {
    let returnObj = {
        css: '',
        map: '',
        duration: 0,
        size: 0,
    };

    if (scss.length) {
        try {
            const result = sass.renderSync({
                file: path,
                outFile: 'build/css/standaloneSiteFooter.css',
                includePaths: options.includePaths,
            });

            returnObj = {
                ...returnObj,
                css: result.css.toString(),
                duration: result.stats.duration,
                size: Buffer.byteLength(result.css, 'utf8'),
            };

        } catch (e) {
            outputError(e, path);
        }
    }

    return returnObj;
}

const outputError = (e, path = ''): void => {
    let message = '';
    let errorTitle = '';

    if (e.message.includes('expected')) {
        errorTitle = `SYNTAX ERROR`;
    } else if (e.message.includes('Can\'t find stylesheet')) {
        errorTitle = 'UNABLE TO FIND IMPORT';
    } else {
        errorTitle = 'ERROR';
    }

    message = `\n-- ${errorTitle} ${'-'.repeat(47 - errorTitle.length)}\n`;
    
    if (e.file || path) {
        message += `File: ${e.file !== 'stdin' ? e.file : path}\n`;
    }
    
    if (e.line) {
        message += `Line: ${e.line}` + (e.column ? `:${e.column}\n` : '');
    } else {
        message += `: `
    }

    message += `\n${e.message}\n`;

    if (e.message.includes('Can\'t find stylesheet')) {
        message += '\nHINT: Is your includePath correct?\n\n';
    }
    
    message += `${'-'.repeat(50)}\n`;

    console.log(chalk.bold.red(message));
}

const createTransform = (filter): Function => (code: string, id: string): string | void => {
    if (!filter(id)) {
        return;
    }
    
    stylesheets.set(id, code);

    return '';
}

const watchChange = (id: string): void => {
    console.log('CHANGE');
}

const createGenerateBundle = (moduleOptions: Options) => function (options: Record<string, any>) {
    const path = stylesheets.keys().next().value;
    const bundleName = basename(path, extname(path));

    let source = '';
    let duration = 0;
    let size = 0;

    stylesheets.forEach((value, key) => {
        const result = transpile(value, key, moduleOptions);
        
        source += result.css;
        duration += result.duration;
        size += result.size;
    });

    this.emitFile({
        source,
        type: 'asset',
        name: bundleName,
        fileName: buildFilename(bundleName, source, options),
    });

    console.log(chalk.green(`${chalk.bold('Processed')}: ${bundleName}.css (${formatSize(size)}) in ${duration}ms\n`));

    return;
}

const buildFilename = (filename: string, contents, options: Record<string, any>): string => {
    let newFilename = options.assetFileNames
        .replace(/\[ext\]/g, 'css')
        .replace(/\[extname\]/g, '.css')
        .replace(/\[name\]/g, filename)
        .replace(/\[hash\]/g, sha1(contents).substr(0, options.hashLength || hashLength));

    return newFilename;
}

const formatSize = (size: number): string => {
    const sizes: [number, string][] = [
        [9, 'GB'],
        [6, 'MB'],
        [3, 'KB'],
        [0, 'B'],
    ];
    
    for (let i = 0; i < sizes.length; i++) {
        const [power, label] = sizes[i];

        if (size > Math.pow(10, power)) {
            const formattedSize = (size / Math.pow(10, power)).toLocaleString('en-US', { maximumFractionDigits: 1 });
            return `${formattedSize}${label}`;
        }
    }

    return '';
}

export default (options = {}) => {
    const moduleOptions = {
        ...defaultOptions,
        ...options
    };

    const filter = createFilter(moduleOptions.include, moduleOptions.exclude);

    return {
        name: 'scss-module-bundler',
        transform: createTransform(filter),
        watchChange,
        generateBundle: createGenerateBundle(moduleOptions),
    };
}
