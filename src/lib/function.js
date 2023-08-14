const axios = require('axios').default
const { tmpdir } = require('os')
const { promisify } = require('util')
const exec = promisify(require('child_process').exec)
const linkify = require('linkifyjs')
const fs = require('fs-extra')
const path = require('path')

const audioToSplit = async (buffer) => {
  const filename = path.join(tmpdir(), `${Math.random().toString(36)}.mp3`)
  await fs.writeFile(filename, buffer)
  try {
    const directory = 'temporary'
    await fs.ensureDir(directory)
    await exec(`ffmpeg -i ${filename} -f segment -segment_time 75 -c:a libmp3lame ${directory}/audio_%03d.mp3`)
    const files = await fs.readdir(directory)
    const buffers = await Promise.all(files.map(x => fs.readFile(path.join(directory, x))))
    await Promise.all([fs.unlink(filename), fs.remove(directory)])
    return buffers
  } catch (error) {
    console.error(error.message)
    return []
  }
}

/**
 * @param {string} url
 * @returns {Promise<Buffer>}
 */

const getBuffer = async (url) =>
    (
        await axios.get(url, {
            responseType: 'arraybuffer'
        })
    ).data

const formatSeconds = (seconds) => new Date(seconds * 1000).toISOString().substr(11, 8)

/**
 * @param {string} content
 * @param {boolean} all
 * @returns {string}
 */

const capitalize = (content, all = false) => {
    if (!all) return `${content.charAt(0).toUpperCase()}${content.slice(1)}`
    return `${content
        .split('')
        .map((text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`)
        .join('')}`
}

/**
 * @returns {string}
 */

const generateRandomHex = () => `#${(~~(Math.random() * (1 << 24))).toString(16)}`

/**
 * @param {string} content
 * @returns {number[]}
 */

const extractNumbers = (content) => {
    const numbers = content.match(/(-?\d+)/g)
    return numbers ? numbers.map((n) => Math.max(parseInt(n), 0)) : []
}

/**
 * @param {string} content
 * @returns {url[]}
 */

const extractUrls = (content) => linkify.find(content).map((url) => url.value)

/**
 * @param {string} url
 */

const fetch = async (url) => (await axios.get(url)).data

module.exports = {
    exec,
    audioToSplit,
    getBuffer,
    formatSeconds,
    capitalize,
    generateRandomHex,
    extractNumbers,
    extractUrls,
    fetch
}
