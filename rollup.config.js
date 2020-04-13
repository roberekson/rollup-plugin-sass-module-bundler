import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

const output = {
    dir: './dist/',
    entryFileNames: '[name].[format].js',
};

const cjsOutput = {
    ...output,
    format: 'cjs',
}

const esOutput = {
    ...output,
    format: 'es',
}

export default {
    input: './src/index.ts',
    output: [cjsOutput, esOutput],
    external: ['path', 'util', '@rollup/pluginutils'],
    plugins: [
        resolve(),
        typescript(),
    ],
};
