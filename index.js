const fs = require("fs")
const path = require("path")
const argv = require("minimist")
const puppeteer = require("puppeteer")
const nodemailer = require("nodemailer")

Array.prototype.chunk = function(n){ return require("lodash").chunk(this, n) }
Array.prototype.unique = function(){ return require("lodash").uniq(this) }

const args = argv(process.argv.slice(2), {
  default: {
    timeout: 120000,
    delay: 1500,
    chunks: 3,
    from: '"Gökay SOLMAN" <gokaysolman@hotmail.com>',
    subject: 'CV - Acil İş Arayışı',
    message: 
        'Merhaba Sayın <strong>{{name}}</strong> yetkilisi;<br/><br/>'+
        'Acil olarak iş arayışım mevcuttur. Firmanızda uygun bir pozisyon varsa dönüş yapabilirseniz sevinirim.<br/>'+
        'İyi çalışmalar dilerim.<br/><br/>'
        '<a href="https://github.com/Sc3n3">GitHub</a>',
    smtp: 'smtp.office365.com',
    port: 587,
    user: undefined,
    pass: undefined,
    attachment: __dirname +'/Gokay Solman.pdf'
  }
})

class BruteResume {

    brands = []
    mailer = undefined
    browser = undefined
    baseUrl = 'https://www.ostimteknopark.com.tr'
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:108.0) Gecko/20100101 Firefox/108.0'

    #fetch = async (cb) => {
        try {
            return await cb.call(null)
        } catch (e) {
            return null
        }
    }

    #send = async (options = {}) => {
        try {
            return await this.mailer.sendMail({
                from: args.from,
                ...options
            })    
        } catch (e) {
            console.error(e)
        }
    }

    #browser = async () => {
        if (!this.browser) {
            this.browser = await puppeteer.launch({ args: ['--no-sandbox'], headless: false, devtools: true })
            process.on('exit', async () => await this.browser.close())    
        }    
        
        return this.browser
    }

    constructor(){
        this.mailer = nodemailer.createTransport({
            host: args.smtp,
            port: args.port,
            secure: false,
            auth: {
                user: args.user,
                pass: args.pass,
            }
        })
    }

    async sendMail(brand){
        const options = {
            to: brand.mail,
            subject: args.subject,
            html: args.message
        }

        for (const key of Object.keys(brand)) {
            options.html = options.html.replace('{{'+ key +'}}', brand[key])
            options.subject = options.subject.replace('{{'+ key +'}}', brand[key])
        }

        if (args.attachment && fs.existsSync(args.attachment)) {
            options.attachments = [{
                filename: path.basename(args.attachment),
                content: fs.readFileSync(args.attachment)
            }]
        }

        return this.#send(options);
    }

    async getBrandDetail(brandUrl){
        const page = await (await this.#browser()).newPage()

        try {
            await page.setUserAgent(this.userAgent)
            await page.goto(brandUrl, { waitUntil: "domcontentloaded", timeout: args.timeout })

            const brandDetail = {
                name: await this.#fetch(() => page.$eval('h1.fz-21', e => e.innerText)),
                mail: await this.#fetch(() => page.$eval('.fa-mail-forward', e => e.nextSibling.nodeValue.trim())),
                phone: await this.#fetch(() => page.$eval('.fa-phone', e => e.nextSibling.nodeValue.trim())),
                website: await this.#fetch(() => page.$eval('.fa-diamond', e => e.nextSibling.nodeValue.trim())),
                address: await this.#fetch(() => page.$eval('.fa-map-marker', e => e.nextSibling.nodeValue.trim()))
            }

            if (!brandDetail.mail && brandDetail.website) {
                brandDetail.mail = await this.getBrandDetailFromWebSite(brandDetail.website)
            }

            brandDetail.mail && this.brands.push(brandDetail)
        } catch (e) { 
            console.error(e)
        } finally {
            await page.close()
        }
    }

    async getBrandDetailFromWebSite(brandUrl){
        const page = await (await this.#browser()).newPage()

        try {
            await page.setUserAgent(this.userAgent)
            await page.goto((brandUrl.slice(0,2) == '//' ? 'http:'+ brandUrl : brandUrl), { waitUntil: "domcontentloaded", timeout: args.timeout })

            const mail = await this.#fetch(() => page.$eval('*', (el) => el.innerText.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi)[0]))

            return mail
        } catch (e) {
            return null
        } finally {
            await page.close()
        }
    }

    async fetchBrands(){
        const page = (await (await this.#browser()).pages())[0]
        await page.setUserAgent(this.userAgent);
        await page.goto(this.baseUrl +"/firma-arsiv", { waitUntil: "domcontentloaded", timeout: args.timeout })

        const brandLinks = await page.$$eval('.ic > .row:nth-child(2) .shadow.border-0 > a', el => el.map(e => e.getAttribute('href')))

        for (const chunks of brandLinks.map(url => this.baseUrl + url).chunk(args.chunks)) {
            await Promise.all(chunks.map(url => this.getBrandDetail(url)))
            await new Promise(resolve => setTimeout(resolve, args.delay))
        }

        await page.close()
        await (await this.#browser()).close()

        return this.brands
    }
}

const bruteResumer = new BruteResume()

bruteResumer.fetchBrands().then(brands => {
    brands.forEach(brand => {
        bruteResumer.sendMail(brand)
    })
    process.exit(0)
})