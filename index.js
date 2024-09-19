import TelegramBot from 'node-telegram-bot-api'
import fs from 'fs'
import util from 'util'
import os from 'os'
import axios from 'axios'
import md5 from 'md5'
import rp from 'request-promise-native'
import fsx from 'fs-extra'
import crypto from 'crypto'
import moment from 'moment-timezone'
import fetch from 'node-fetch'
import FormData from 'form-data';
import path from 'path';
import {
    createCanvas,
    loadImage
} from 'canvas'
import {
	token,
    username,
    apiKey,
    owner,
	namarekening,
	paydisini_apikey,
	paydisini_nomer,
	minimalDepoOtomatis,
	maximalDepoOtomatis,
	medanpedia_apikey,
	medanpedia_apiID
} from './db/config.js';
import {
    connect
} from './lib/myfunc.js';

// Telegram Bot Token
const channelId = '-1002365210753'; // ganti dengan channel id kamu
const maxMessageLength = 4000;
const bot = new TelegramBot(token, {
    polling: true
});

// Path Database
const pathUser = './db/users.json';
const productData = './db/datadigi.json';
const productMP = './db/datamedanpedia.json';

const defaultMarkupPercentage = 0.3;
let markupConfig = {};
const markupFilePath = './db/markup.json';
if (fs.existsSync(markupFilePath)) {
    markupConfig = JSON.parse(fs.readFileSync(markupFilePath, 'utf8'));
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const time1 = moment().tz('Asia/Jakarta').format('HH:mm:ss')
const hariini = moment.tz('Asia/Jakarta').locale('id').format('dddd,D MMM YYYY');

// Function
function generateUniqueRefID(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var charactersLength = characters.length;

    for (var i = 0; i < length; i++) {
        var randomIndex = Math.floor(Math.random() * charactersLength);
        result += characters.charAt(randomIndex);
    }
    result = 'JFx' + result;
    return result;
}

function formatmoney(amount) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(amount);
}

function parseDate(dateString) {
    const [time, dayOfWeek, day, month, year] = dateString.split(/[\s,|]+/);
    const [hours, minutes, seconds] = time.split(':').map(part => parseInt(part, 10));
    const months = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };
    return new Date(year, months[month.substr(0, 3)], parseInt(day, 10), hours, minutes, seconds);
}

async function sendMultipleMessages(chatId, message) {
    let chunks = [];

    for (let i = 0; i < message.length; i += maxMessageLength) {
        chunks.push(message.substring(i, i + maxMessageLength));
    }
	
    for (let chunk of chunks) {
        await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
}

async function checkPaymentStatusOrder(msg, args, unique_code, startTime, product, customer_no, userData, nomor) {
    const currentTime = Date.now();
    const paydisiniApikey = paydisini_apikey;
    const sign = md5(paydisiniApikey + unique_code + "StatusTransaction");

    let buyer_sku_code = args[0].toLowerCase();

    const formData = new FormData();
    formData.append("key", paydisiniApikey);
    formData.append("request", "status");
    formData.append("unique_code", unique_code);
    formData.append("signature", sign);

    try {
        const response = await axios.post('https://paydisini.co.id/api/', formData, {
            headers: formData.getHeaders()
        });

        const responseData = response.data;

        if (responseData.success === true) {
            const data = responseData.data;

            if (data.status === 'Success') {

                let invos = `── 「 MEMPROSES PESANAN 」 ──\n\n`;
                invos += `Pembayaran Berhasil\nPesananmu ${product.product_name} sedang diproses...`;
                bot.sendMessage(msg.chat.id, invos);

                const ref_id = generateUniqueRefID(8);
                const signature = crypto.createHash("md5").update(username + apiKey + ref_id).digest("hex");
                const config = {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        username: username,
                        buyer_sku_code: product.buyer_sku_code,
                        customer_no: buyer_sku_code.startsWith('ml') ? customer_no.replace(' ', '') : customer_no,
                        ref_id: ref_id,
                        sign: signature,
                    }),
                };
                fetch("https://api.digiflazz.com/v1/transaction", config)
                    .then(async (response) => {
                        const data = await response.json();
                        const dataStatus = data.data.status;

                        while (dataStatus !== "Sukses") {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            const response = await fetch("https://api.digiflazz.com/v1/transaction", config);
                            const updatedData = await response.json();
                            const updatedStatus = updatedData.data.status;

                            const userData = JSON.parse(fs.readFileSync('./db/users.json'));
                            const userRole = userData.find((role) => role.nomor === nomor);

                            const originalPrice = parseFloat(product.price);
                            let markupPercentage = defaultMarkupPercentage;

                            if (userRole === "GOLD") {
                                markupPercentage = markupConfig.gold;
                            } else if (userRole === "PLATINUM") {
                                markupPercentage = markupConfig.platinum;
                            } else if (userRole === "BRONZE") {
                                markupPercentage = markupConfig.bronze;
                            } else if (userRole === "OWNER") {
                                markupPercentage = markupConfig.owner;
                            }

                            const increasedPrice = originalPrice * (1 + markupPercentage);
                            const adjustedPrice = Math.round(increasedPrice);

                            let adjustedPrices = parseFloat(adjustedPrice);
                            let fee = parseFloat(responseData.data.fee);

                            if (updatedStatus === "Gagal") {
                                let totalh = adjustedPrices + fee;

                                loadImage('./lib/gagal.png').then((background) => {
                                    let canvas = createCanvas(background.width, background.height);
                                    let ctx = canvas.getContext('2d');

                                    ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

                                    ctx.font = '30px Noto Sans';
                                    ctx.fillStyle = '#fff';
                                    ctx.textAlign = 'left';

                                    let y = 280;
                                    ctx.font = 'bold 23px Noto Sans';
                                    ctx.fillText(`${hariini} ${time1}`, 305, 1043);
                                    ctx.font = '30px Noto Sans';
                                    const text = `${updatedData.data.message}`;
                                    const maxCharsPerLine = 35;
                                    let lines = [];
                                    let line = '';
                                    for (let i = 0; i < text.length; i++) {
                                        line += text[i];
                                        if ((i + 1) % maxCharsPerLine === 0 || i === text.length - 1) {
                                            lines.push(line);
                                            line = '';
                                        }
                                    }

                                    lines.forEach((lineText, index) => {
                                        ctx.fillText(lineText, 32, 620 + index * 30);
                                    });

                                    y += lines.length * 30;
                                    ctx.font = '30px Noto Sans';
                                    ctx.fillText(`${msg.from.first_name}`, 32, 372);
                                    ctx.fillText(`${customer_no}`, 430, 175);
                                    ctx.fillText(`${updatedData.data.ref_id}`, 317, 744);
                                    y += 270;
                                    ctx.font = 'bold 27px Noto Sans';
                                    const textt = `${product.product_name}`;
                                    const maxCharsPerLinet = 23;
                                    let linest = [];
                                    let linet = '';
                                    for (let i = 0; i < textt.length; i++) {
                                        linet += text[i];
                                        if ((i + 1) % maxCharsPerLinet === 0 || i === textt.length - 1) {
                                            linest.push(linet);
                                            linet = '';
                                        }
                                    }

                                    linest.forEach((lineText, index) => {
                                        ctx.fillText(lineText, 263, 60 + index * 30);
                                    });

                                    let buffer = canvas.toBuffer();
                                    bot.sendPhoto(msg.chat.id, buffer, {
                                        caption: 'Transaksi gagal.'
                                    });

                                }).catch((error) => {
                                    console.error('Error loading background:', error);
                                    bot.sendMessage(msg.chat.id, 'An error occurred while loading the background.');
                                });

                                fs.writeFileSync(pathUser, JSON.stringify(userData, null, 2));
                                break;
                            } else if (updatedStatus === "Sukses") {
                                let totalh = adjustedPrices + fee;

                                loadImage('./lib/sukses.png').then((background) => {
                                    let canvas = createCanvas(background.width, background.height);
                                    let ctx = canvas.getContext('2d');

                                    ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

                                    ctx.font = '30px Noto Sans';
                                    ctx.fillStyle = '#fff';
                                    ctx.textAlign = 'left';

                                    let y = 280;
                                    ctx.font = 'bold 23px Noto Sans';
                                    ctx.fillText(`${hariini} ${time1}`, 305, 1043);
                                    ctx.font = '30px Noto Sans';
                                    const text = `${updatedData.data.sn}`;
                                    const maxCharsPerLine = 35;
                                    let lines = [];
                                    let line = '';
                                    for (let i = 0; i < text.length; i++) {
                                        line += text[i];
                                        if ((i + 1) % maxCharsPerLine === 0 || i === text.length - 1) {
                                            lines.push(line);
                                            line = '';
                                        }
                                    }

                                    lines.forEach((lineText, index) => {
                                        ctx.fillText(lineText, 32, 620 + index * 30);
                                    });
                                    y += lines.length * 30;

                                    ctx.font = '30px Noto Sans';
                                    ctx.fillText(`${msg.from.first_name}`, 32, 372);
                                    ctx.fillText(`${customer_no}`, 430, 175);
                                    ctx.fillText(`${updatedData.data.ref_id}`, 317, 744);
                                    y += 270;

                                    ctx.font = 'bold 27px Noto Sans';
                                    const textt = `${product.product_name}`;
                                    const maxCharsPerLinet = 26;
                                    let linest = [];
                                    let linet = '';
                                    for (let i = 0; i < textt.length; i++) {
                                        linet += textt[i];
                                        if ((i + 1) % maxCharsPerLinet === 0 || i === textt.length - 1) {
                                            linest.push(linet);
                                            linet = '';
                                        }
                                    }

                                    linest.forEach((lineText, index) => {
                                        ctx.fillText(lineText, 263, 57 + index * 30);
                                    });
                                    y += lines.length * 30;

                                    let invos = `── 「 TRANSAKSI SUKSES 」 ──\n\n`
                                    invos += `Pesananmu ${product.product_name} sudah dikirim`;

                                    let buffer = canvas.toBuffer();
                                    bot.sendPhoto(msg.chat.id, buffer, {
                                        caption: invos
                                    });

                                }).catch((error) => {
                                    console.error('Error loading background:', error);
                                    bot.sendMessage(msg.chat.id,'An error occurred while loading the background.');
                                });

                                let transactions = [];
                                if (fs.existsSync("./db/trx.json")) {
                                    const rawData = fs.readFileSync("./db/trx.json", "utf8");
                                    transactions = JSON.parse(rawData);
                                }
                                const newTransaction = {
                                    nomor: nomor,
                                    status: updatedStatus,
                                    invoice: updatedData.data.ref_id,
                                    item: product.product_name,
                                    rc: updatedData.data.rc,
                                    tujuan: customer_no,
                                    harga: adjustedPrice,
                                    waktu: `${time1} | ${hariini}`,
                                };
                                transactions.push(newTransaction);
                                fs.writeFileSync("./db/trx.json", JSON.stringify(transactions, null, 2));

                                let toOwn = `── 「 LAPORAN TRANSAKSI 」 ──\n\n`;
								toOwn += `Nama: ${msg.from.first_name}\n`;
								toOwn += `User ID: ${msg.from.id}\n`;
								toOwn += `Harga Jual: Rp ${adjustedPrice.toLocaleString()}\n`;
								toOwn += `Harga Modal: Rp ${originalPrice.toLocaleString()}\n`;
								toOwn += `Produk: ${product.product_name}\n`;
								toOwn += `Tujuan: ${customer_no}`;

                                setTimeout(() => {
                                    bot.sendMessage(parseInt(owner), toOwn).then(() => {
                                        console.log(`Pesan terkirim ke owner: ${owner}`);
                                    }).catch(error => {
                                        console.error(`Gagal mengirim pesan ke owner: ${owner}`, error);
                                    });
                                }, 10000);
                                break;
                            }
                        }
                    });
            } else if (data.status === 'Canceled') {
                await bot.sendMessage(msg.chat.id, 'Pembayaran sudah dibatalkan.\nSilahkan lakukan deposit ulang!');
            } else {
                if (currentTime - startTime < 300000) {
                    setTimeout(() => {
                        checkPaymentStatusOrder(msg, args, unique_code, startTime, product, customer_no, userData, nomor);
                    }, 10000);
                } else {
                    await bot.sendMessage(msg.chat.id, 'QR sudah kadaluwarsa.\nSilahkan lakukan deposit ulang!');
                }
            }
        } else {
            await bot.sendMessage(msg.chat.id, responseData.msg);
        }

    } catch (error) {
        console.error('An error occurred:', error);
        await bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat memeriksa status pembayaran.');
    }
}

async function checkPaymentStatusPaydisini(unique_code, startTime, msg) {
    const currentTime = Date.now();
    const targetDepoOtomatis = msg.from.id;
    const paydisiniApikey = paydisini_apikey;
    const sign = md5(paydisiniApikey + unique_code + "StatusTransaction");

    const formData = new FormData();
    formData.append("key", paydisiniApikey);
    formData.append("request", "status");
    formData.append("unique_code", unique_code);
    formData.append("signature", sign);

    try {
        const response = await axios.post('https://paydisini.co.id/api/', formData, {
            headers: formData.getHeaders()
        });

        const responseData = response.data;

        if (responseData.success === true) {
            const data = responseData.data;

            if (data.status === 'Success') {
                const amountReceived = parseFloat(data.balance);

                let userData = JSON.parse(fs.readFileSync(pathUser, 'utf8'));
                let targetUserIndex = userData.findIndex(user => String(user.nomor) === String(targetDepoOtomatis));

                if (targetUserIndex !== -1) {
                    userData[targetUserIndex].saldo = (parseFloat(userData[targetUserIndex].saldo) || 0) + amountReceived;
                }

                fs.writeFileSync(pathUser, JSON.stringify(userData, null, 2));
                let depos = `[ Pembayaran Berhasil ]\n\n`;
                depos += `Saldo kamu telah bertambah sebesar ${formatmoney(amountReceived)}\n`;
                depos += `Ref ID : ${data.unique_code}\n\n`;
                depos += `Silahkan klik Info Akun untuk detail.`;
				
				const options = {
					reply_markup: {
						inline_keyboard: [
							[{
								text: 'Info Akun',
								callback_data: 'me'
							}]
						]
					}
				};

				await bot.sendMessage(msg.chat.id, depos, options);

            } else if (data.status === 'Canceled') {
                await bot.sendMessage(msg.chat.id, 'Pembayaran sudah dibatalkan.\nSilahkan lakukan deposit ulang!');
            } else {
                if (currentTime - startTime < 300000) { 
                    setTimeout(() => {
                        checkPaymentStatusPaydisini(unique_code, startTime, msg);
                    }, 10000);
                } else {
                    await bot.sendMessage(msg.chat.id, 'QR sudah kadaluwarsa.\nSilahkan lakukan deposit ulang!');
                }
            }
        } else {
            await bot.sendMessage(msg.chat.id, responseData.msg);
        }

    } catch (error) {
        console.error('An error occurred:', error);
        await bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat memeriksa status pembayaran.');
    }
}


// '/start' command
bot.onText(/\/start/, (msg) => {
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{
                        text: 'Games',
                        callback_data: 'category_games'
                    },
                    {
                        text: 'Pulsa',
                        callback_data: 'category_pulsa'
                    },
                    {
                        text: 'E-money',
                        callback_data: 'category_e-money'
                    },
                    {
                        text: 'PLN',
                        callback_data: 'category_pln'
                    }
                ],
                [{
                        text: 'Me',
                        callback_data: 'me'
                    },
                    {
                        text: 'Deposit',
                        callback_data: 'deposit'
                    },
                    {
                        text: 'TopUser',
                        callback_data: 'topuser'
                    },
                    {
                        text: 'TopLayanan',
                        callback_data: 'toplayanan'
                    }
                ],
                [{
                        text: 'Cekriwayat',
                        callback_data: 'cekriwayat'
                    },
                    {
                        text: 'Upgrade',
                        callback_data: 'upgrade'
                    },
                    {
                        text: 'Cek Nickname',
                        callback_data: 'ceknickname'
                    }
                ],
				[{
                    text: '✨ SMM Panel',
                    callback_data: 'smm'
                }],
                [{
                    text: '👑 Menu Owner',
                    callback_data: 'owner'
                }]
            ]
        }
    };

    bot.sendMessage(msg.chat.id, "Hallo " + msg.from.first_name + ", Selamat belanja di Amang Store\nSilahkan pilih menu dibawah ini", options).catch(err => {
        console.error('Error sending message:', err);
    });
});

bot.onText(/\/list/, (msg) => {
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{
                        text: 'Games',
                        callback_data: 'category_games'
                    },
                    {
                        text: 'Pulsa',
                        callback_data: 'category_pulsa'
                    },
                    {
                        text: 'E-money',
                        callback_data: 'category_e-money'
                    },
                    {
                        text: 'PLN',
                        callback_data: 'category_pln'
                    }
                ],
                [{
                        text: 'Me',
                        callback_data: 'me'
                    },
                    {
                        text: 'Deposit',
                        callback_data: 'deposit'
                    },
                    {
                        text: 'TopUser',
                        callback_data: 'topuser'
                    },
                    {
                        text: 'TopLayanan',
                        callback_data: 'toplayanan'
                    }
                ],
                [{
                        text: 'Cekriwayat',
                        callback_data: 'cekriwayat'
                    },
                    {
                        text: 'Upgrade',
                        callback_data: 'upgrade'
                    },
                    {
                        text: 'Cek Nickname',
                        callback_data: 'ceknickname'
                    }
                ],
				[{
                    text: '✨ SMM Panel',
                    callback_data: 'smm'
                }],
                [{
                    text: '👑 Menu Owner',
                    callback_data: 'owner'
                }]
            ]
        }
    };

    bot.sendMessage(msg.chat.id, "Hallo " + msg.from.first_name + ", Selamat belanja di SalmonPay\nSilahkan pilih menu dibawah ini", options).catch(err => {
        console.error('Error sending message:', err);
    });
});

const handleCategory = (category, query) => {
    try {
        const productData = JSON.parse(fs.readFileSync('./db/datadigi.json', 'utf8'));
        const filteredProducts = productData.filter(item => item.category.toLowerCase() === category);
        const brands = [...new Set(filteredProducts.map(item => item.brand))];

        if (brands.length > 0) {
            const pushname = query.from.first_name || query.from.username;
            let capt = `Hallo ${pushname}\nPilih kategori untuk melihat harga\n\n`;

            const inlineKeyboard = brands.map(brand => [{
                text: brand,
                callback_data: `brand_${brand.toLowerCase()}`
            }]);
            inlineKeyboard.push([{
                text: '⬅️ Back',
                callback_data: 'handleBack'
            }]);

            bot.sendMessage(query.message.chat.id, capt, {
                reply_markup: {
                    inline_keyboard: inlineKeyboard
                }
            });
        }
    } catch (error) {
        console.error('Error reading product data:', error);
        bot.sendMessage(query.message.chat.id, 'Terjadi kesalahan saat membaca data produk.');
    }
};


const handleBrand = (brand, query) => {
    try {
        const nomor = parseInt(query.from.id);
        const productData = JSON.parse(fs.readFileSync('./db/datadigi.json', 'utf8'));
        const userData = JSON.parse(fs.readFileSync('./db/users.json', 'utf8'));
        const userProfile = userData.find(user => user.nomor === nomor);

        if (!userProfile) {
            bot.sendMessage(query.message.chat.id, `Kamu belum terdaftar, silahkan ketik /daftar untuk bisa mengakses`);
            return;
        }

        const requestedBrand = brand.trim().toLowerCase();
        if (!requestedBrand) {
            bot.sendMessage(query.message.chat.id, 'Masukan nama brand.');
            return;
        }

        const matchingProducts = productData.filter(item => item.brand.toLowerCase() === requestedBrand);

        if (matchingProducts.length === 0) {
            bot.sendMessage(query.message.chat.id, `Produk dengan brand ${requestedBrand.toUpperCase()} tidak ditemukan.`);
            return;
        }

        const {
            role
        } = userProfile;
        let markupPercentage = defaultMarkupPercentage;

        if (role === "GOLD") {
            markupPercentage = markupConfig.gold;
        } else if (role === "PLATINUM") {
            markupPercentage = markupConfig.platinum;
        } else if (role === "BRONZE") {
            markupPercentage = markupConfig.bronze;
        } else if (role === "OWNER") {
            markupPercentage = markupConfig.owner;
        }

		matchingProducts.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

		const formattedResponse = `Hallo ${query.from.first_name || query.from.username} Role Kamu ${role}\nBerikut LIST ${requestedBrand.toUpperCase()} Untukmu\n\n` +
			`Cara Beli :\n` +
			`Contoh menggunakan qris :\n` +
			`/topup ML10 181141484 2923\n\n` +
			`Contoh menggunakan saldo :\n` +
			`/order ML10 181141484 2923\n\n`

		const maxMessageLength = 4000;
		const sendMessageDelay = 1500;

		let currentMessage = formattedResponse;

		const formatSaldo = (amount) => `Rp. ${amount.toLocaleString()}`;

		for (let i = 0; i < matchingProducts.length; i++) {
			const product = matchingProducts[i];
			const originalPrice = parseFloat(product.price);
			const increasedPrice = originalPrice * (1 + markupPercentage);
			const adjustedPrice = Math.round(increasedPrice);

			const productInfo = `${product.product_name}\n` +
				`> Kode SKU : ${product.buyer_sku_code}\n` +
				`> Harga : ${formatSaldo(adjustedPrice)}\n` +
				`> Status : ${product.seller_product_status ? '✅ ' : '❌'}\n` +
				`-⊶-⊶-⊶-⊶-⊶-⊶-⊶-⊶-\n`;

			if ((currentMessage + productInfo).length > maxMessageLength) {
				sendMessageWithDelay(query.message.chat.id, currentMessage);
				currentMessage = formattedResponse; 
				new Promise(resolve => setTimeout(resolve, sendMessageDelay));
			}

			currentMessage += productInfo;
		}

		if (currentMessage.length > 0) {
			sendMessageWithDelay(query.message.chat.id, currentMessage);
		}

		async function sendMessageWithDelay(chatId, message) {
			bot.sendMessage(chatId, message);
			new Promise(resolve => setTimeout(resolve, sendMessageDelay));
		}

    } catch (error) {
        console.error('Error processing brand data:', error);
        bot.sendMessage(query.message.chat.id, 'Terjadi kesalahan saat memproses data produk.');
    }
};

const handleBack = (query) => {
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{
                        text: 'Games',
                        callback_data: 'category_games'
                    },
                    {
                        text: 'Pulsa',
                        callback_data: 'category_pulsa'
                    },
                    {
                        text: 'E-money',
                        callback_data: 'category_e-money'
                    },
                    {
                        text: 'PLN',
                        callback_data: 'category_pln'
                    }
                ],
                [{
                        text: 'Me',
                        callback_data: 'me'
                    },
                    {
                        text: 'Deposit',
                        callback_data: 'deposit'
                    },
                    {
                        text: 'TopUser',
                        callback_data: 'topuser'
                    },
                    {
                        text: 'TopLayanan',
                        callback_data: 'toplayanan'
                    }
                ],
                [{
                        text: 'Cekriwayat',
                        callback_data: 'cekriwayat'
                    },
                    {
                        text: 'Upgrade',
                        callback_data: 'upgrade'
                    },
                    {
                        text: 'Cek Nickname',
                        callback_data: 'ceknickname'
                    }
                ],
				[{
                    text: '✨ SMM Panel',
                    callback_data: 'smm'
                }],
                [{
                    text: '👑 Menu Owner',
                    callback_data: 'owner'
                }]
            ]
        }
    };

    bot.sendMessage(query.message.chat.id, "Hallo " + query.from.first_name + ", Selamat belanja di SalmonPay\nSilahkan pilih menu dibawah ini", options).catch(err => {
        console.error('Error sending message:', err);
    });
};

const handleMe = (query) => {
    const userNomor = query.from.id;
    const userData = JSON.parse(fs.readFileSync(pathUser));
    const userProfile = userData.find((user) => user.nomor === userNomor);

    if (!userProfile) {
        bot.sendMessage(query.message.chat.id, 'Silahkan daftar dahulu');
    } else {
        const {
            nomor,
            saldo,
            role
        } = userProfile;
        const formatSaldo = (amount) => `Rp. ${amount.toLocaleString()}`;
        const profileMessage = `──〔 Profile 〕──\n\nName : ${query.from.first_name}\nUser ID : ${nomor}\nSaldo : ${formatSaldo(saldo)}\nRole : ${role}\n\nCek riwayat transaksi mu dengan cara\nketik /cekriwayat\n\nIngin upgrade role?\nketik /upgrade`;

        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: '⬅️ Back',
                        callback_data: 'handleBack'
                    }]
                ]
            }
        };

        bot.sendMessage(query.message.chat.id, profileMessage, options);
    }
};

const handleAdmin = (query) => {
	
	const options = {
        reply_markup: {
            inline_keyboard: [
                [{
                    text: '⬅️ Back',
                    callback_data: 'handleBack'
                }]
            ]
        }
    };

    bot.sendMessage(query.message.chat.id, "<a href=\"https://t.me/xvoxy\">Voxy</a>", { parse_mode: "HTML" }, options );
};

const handleDeposit = (query) => {
    const nomor = query.from.id;
    let capt = `Untuk Deposit Manual Silahkan Transfer ke Payment dibawah ini\n\n`;
    capt += `Bank dan E-Wallet\n`;
    capt += `5125076391 | BCA\n`;
    capt += `901229360223 | SEABANK\n`;
    capt += `082154468475 | DANA (+100 perak)\n`;
    capt += `082154468475 | OVO\n`;
    capt += `082154468475 | SHOPEEPAY\n`;
    capt += `Pembayaran dari Bank ke E-Wallet Wajib +1500 !!!\n\n`;
    capt += `Note :\n`;
    capt += `- Wajib Sertakan Screenshot Detail Pembayaran!!!\n`;
    capt += `- Jika sudah Transfer Pembayaran langsung chat kontak Admin dibawah ini agar Saldo Deposit kamu di Proses.`;
    const options = {
        reply_markup: {
            inline_keyboard: [
				[{
                    text: 'Deposit Otomatis',
                    callback_data: 'depo'
                },
				{
                    text: 'Admin',
                    callback_data: 'noadmin'
                }],
                [{
                    text: '⬅️ Back',
                    callback_data: 'handleBack'
                }]
            ]
        }
    };

    bot.sendMessage(query.message.chat.id, capt, options);
};

const handleDepo = (query) => {
    const nomor = query.from.id;
    let capt = `Untuk melakukan deposit otomatis silahkan ketik\n/deposit [nominalnya]\n/deposit 10000`;
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{
                    text: '⬅️ Back',
                    callback_data: 'handleBack'
                }]
            ]
        }
    };

    bot.sendMessage(query.message.chat.id, capt, options);
};

const handleSMM = (query) => {
    const nomor = query.from.id;
    let capt = `━━[ Salmon Bot ]━━\n\n`;
    capt += `Silahkan pilih menu dibawah ini\n\n`
    capt += `/saldomp\n`
    capt += `/layananmp -> untuk update layanan\n`
	capt += `/smp -> untuk lihat layanan\n`
	capt += `/omp -> untuk order smm\n`
	capt += `/statusmp -> untuk cek status order`

    const options = {
        reply_markup: {
            inline_keyboard: [
                [{
                    text: '⬅️ Back',
                    callback_data: 'handleBack'
                }]
            ]
        }
    };

    bot.sendMessage(query.message.chat.id, capt, options);
};

const handleCeknickname = (query) => {
    const nomor = query.from.id;
    let capt = `━━[ Salmon Bot ]━━\n\n`;
    capt += `Silahkan pilih menu dibawah ini\n\n`
	capt += `/cekrekening\n`
    capt += `/cekml\n`
    capt += `/cekff\n`
	capt += `/cekaov\n`
	capt += `/cekcodm`

    const options = {
        reply_markup: {
            inline_keyboard: [
                [{
                    text: '⬅️ Back',
                    callback_data: 'handleBack'
                }]
            ]
        }
    };

    bot.sendMessage(query.message.chat.id, capt, options);
};

const handleOwner = (query) => {
    const nomor = query.from.id;
    let capt = `━━[ Salmon Bot ]━━\n\n`;
    capt += `Silahkan pilih menu dibawah ini\n\n`
	capt += `/isisaldo\n`
    capt += `/saldodigi\n`
    capt += `/updatedigi\n`
    capt += `/addsaldo\n`
    capt += `/kurangsaldo\n`
    capt += `/setmarkup\n`
    capt += `/cekmarkup\n`
    capt += `/user`

    const options = {
        reply_markup: {
            inline_keyboard: [
                [{
                    text: '⬅️ Back',
                    callback_data: 'handleBack'
                }]
            ]
        }
    };

    bot.sendMessage(query.message.chat.id, capt, options);
};

const handleTopUser = (query) => {
    let rawDatas = [];
    if (fs.existsSync("./db/trx.json")) {
        rawDatas = JSON.parse(fs.readFileSync("./db/trx.json", "utf8"));
    }

    const userOrders = rawDatas.reduce((acc, transaction) => {
        if (transaction.status.toLowerCase() === 'sukses') {
            acc[transaction.nomor] = (acc[transaction.nomor] || 0) + 1;
        }
        return acc;
    }, {});

    const sortedUsers = Object.keys(userOrders).sort((a, b) => userOrders[b] - userOrders[a]);

    if (sortedUsers.length === 0) {
        bot.sendMessage(query.message.chat.id, 'Tidak ada pengguna dengan transaksi sukses.');
        return;
    }

    let topUserText = '───〔 Top Users 〕──\n\n';

    sortedUsers.forEach((user, index) => {
        topUserText += `#${index + 1} User ID : ${user}\nTotal Order: ${userOrders[user]}\n\n`;
    });

    topUserText += '───〔 Top Users 〕──';

    const options = {
        reply_markup: {
            inline_keyboard: [
                [{
                    text: '⬅️ Back',
                    callback_data: 'handleBack'
                }]
            ]
        }
    };

    bot.sendMessage(query.message.chat.id, topUserText, options);
};

const handleTopLayanan = (query) => {
    let rawDatas = [];
    if (fs.existsSync("./db/trx.json")) {
        rawDatas = JSON.parse(fs.readFileSync("./db/trx.json", "utf8"));
    }

    const itemOrders = rawDatas.reduce((acc, transaction) => {
        if (transaction.status.toLowerCase() === 'sukses') {
            acc[transaction.item] = (acc[transaction.item] || 0) + 1;
        }
        return acc;
    }, {});

    const sortedItems = Object.keys(itemOrders).sort((a, b) => itemOrders[b] - itemOrders[a]);

    if (sortedItems.length === 0) {
        bot.sendMessage(query.message.chat.id, 'Tidak ada layanan dengan transaksi sukses.');
        return;
    }

    let topItemText = '───〔 Top Layanan 〕──\n\n';

    sortedItems.forEach((item, index) => {
        topItemText += `#${index + 1} ${item}\nTotal Order: ${itemOrders[item]}\n\n`;
    });

    topItemText += '───〔 Top Layanan 〕──';

    const options = {
        reply_markup: {
            inline_keyboard: [
                [{
                    text: '⬅️ Back',
                    callback_data: 'handleBack'
                }]
            ]
        }
    };

    bot.sendMessage(query.message.chat.id, topItemText, options);
};

const handleCekRiwayat = (query) => {
    const target = parseInt(query.from.id);

    let rawDatas = [];
    if (fs.existsSync("./db/trx.json")) {
        rawDatas = JSON.parse(fs.readFileSync("./db/trx.json", "utf8"));
    }

    const userTransactions = rawDatas.filter(user => user.nomor === target && user.status.toLowerCase() === 'sukses');

    if (userTransactions.length === 0) {
        bot.sendMessage(query.message.chat.id, 'Kamu belum melakukan transaksi.');
        return;
    }

    userTransactions.sort((a, b) => parseDate(b.waktu) - parseDate(a.waktu));

    let transactionHistory = `───〔 Riwayat Transaksi 〕──\n\n`;
    transactionHistory += `» Total Transaksi : ${userTransactions.length}\n\n`;

    userTransactions.forEach(transaction => {
        transactionHistory += `» Trx Id : ${transaction.invoice}\n`;
        transactionHistory += `» Item : ${transaction.item}\n`;
        transactionHistory += `» Status : ${transaction.status}\n`;
        transactionHistory += `» Harga : Rp. ${transaction.harga.toLocaleString()}\n`;
        transactionHistory += `» Tujuan : ${transaction.tujuan}\n`;
        transactionHistory += `» Waktu : ${transaction.waktu}\n`;
        transactionHistory += `───────────────\n`;
    });

    const options = {
        reply_markup: {
            inline_keyboard: [
                [{
                    text: '⬅️ Back',
                    callback_data: 'handleBack'
                }]
            ]
        }
    };

    bot.sendMessage(query.message.chat.id, transactionHistory, options);
};

const handleUpgrade = (query) => {
    const target = query.from.id.toString();

    let userData = [];
    if (fs.existsSync(pathUser)) {
        userData = JSON.parse(fs.readFileSync(pathUser, 'utf8'));
    }

    const targetUser = userData.find(user => user.nomor.toString() === target);
    if (!targetUser) {
        bot.sendMessage(query.message.chat.id, `${target} belum terdaftar`);
        return;
    }

    const availableRoles = ['bronze', 'gold', 'platinum'];
    const currentRoleIndex = availableRoles.indexOf(targetUser.role.toLowerCase());

    if (currentRoleIndex === -1) {
        bot.sendMessage(query.message.chat.id, `Role ${targetUser.role} tidak valid`);
        return;
    }

    const nextRoleIndex = currentRoleIndex + 1;
    const nextRole = availableRoles[nextRoleIndex];

    if (!nextRole) {
        bot.sendMessage(query.message.chat.id, `Anda sudah tidak dapat Upgrade Role.`);
        return;
    }

    const rolePrices = {
        gold: 35000,
        platinum: 70000,
    };

    const rolePrice = rolePrices[nextRole];

    if (targetUser.saldo < rolePrice) {
        bot.sendMessage(query.message.chat.id, `Maaf, saldo anda tidak cukup untuk upgrade\nRole : ${nextRole.toUpperCase()}\nHarga : Rp ${rolePrices[nextRole].toLocaleString()}`);
        return;
    }

    targetUser.saldo -= rolePrice;
    const prevRole = targetUser.role;
    targetUser.role = nextRole.toUpperCase();
    fs.writeFileSync(pathUser, JSON.stringify(userData, null, 2));

    let capt = `──〔 UPDATE ROLE 〕──\n\nRole Awal : ${prevRole}\nRole Baru : ${targetUser.role}\n\nBerhasil melakukan upgrade role.`;

    const options = {
        reply_markup: {
            inline_keyboard: [
                [{
                    text: '⬅️ Back',
                    callback_data: 'handleBack'
                }]
            ]
        }
    };

    bot.sendMessage(query.message.chat.id, capt, options);
};

bot.on('callback_query', (query) => {
    const data = query.data;

    if (data.startsWith('category_')) {
        const category = data.split('_')[1];
        handleCategory(category, query);
    } else if (data.startsWith('brand_')) {
        const brand = data.split('_')[1];
        handleBrand(brand, query);
    } else if (data === 'me') {
        handleMe(query);
    } else if (data === 'deposit') {
        handleDeposit(query);
    } else if (data === 'topuser') {
        handleTopUser(query);
    } else if (data === 'toplayanan') {
        handleTopLayanan(query);
    } else if (data === 'cekriwayat') {
        handleCekRiwayat(query);
    } else if (data === 'upgrade') {
        handleUpgrade(query);
    } else if (data === 'pay') {
        handlePay(query);
    } else if (data === 'owner') {
        if (owner.includes(query.from.id.toString())) {
            handleOwner(query);
        } else {
            bot.sendMessage(query.message.chat.id, 'Fitur khusus owner!');
        }
    } else if (data === 'handleBack') {
        handleBack(query);
    } else if (data === 'ceknickname') {
        handleCeknickname(query);
    } else if (data === 'depo') {
        handleDepo(query);
    } else if (data === 'noadmin') {
        handleAdmin(query);
    } else if (data === 'smm') {
        handleSMM(query);
    }
});


bot.onText(/\/lists/, (msg) => {
    let menuq = `Hallo ${msg.from.first_name}, Selamat datang di Bot\n`
    menuq += `Ketik salah satu menu berikut\n\n`
    menuq += `── [ Produk Digital ] ──\n`
    menuq += `/games\n`
    menuq += `/pulsa\n`
    menuq += `/emoney\n`
    menuq += `/pLN\n`
    menuq += `── [ Menu Profile ] ──\n`
    menuq += `/me\n`
    menuq += `/deposit\n`
    menuq += `/TopUser\n`
    menuq += `/TopLayanan\n`
    menuq += `/Cekml -> Mobile Legends\n`
    menuq += `/Cekff -> Free Fire\n`
    menuq += `/Cekaov -> Arena of Valor\n`
    menuq += `/Ceksus -> Super Sus\n`
    menuq += `/Cekcodm -> Call of Duty Mobile\n`
    menuq += `/Cekgi -> Genshin Impact\n`
    menuq += `/Cekhsr -> Honkai: Star Rail\n`
    menuq += `/CaraTopup\n`
    menuq += `/CekRiwayat\n`
    menuq += `/Upgrade\n`
    menuq += `/Pay`
    bot.sendMessage(msg.chat.id, menuq);
});

bot.onText(/\/isisaldo(?: (\d+) (\w+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
	const userId = msg.from.id.toString();
	
    if (!owner.includes(userId)) {
        bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
        return;
    }

    if (!match[1] || !match[2]) {
        bot.sendMessage(chatId, 'Penggunaan : isisaldo <jumlah> <bank>\nMinimal jumlah 200.000');
        return;
    }

    const amount = parseInt(match[1]);
    const bank = match[2].toUpperCase();
    const supportedBanks = ['BCA', 'MANDIRI', 'BRI', 'BNI'];

    if (isNaN(amount) || !supportedBanks.includes(bank)) {
        bot.sendMessage(chatId, 'Penggunaan : isisaldo <jumlah> <bank>\nMinimal jumlah 200.000\nBank yang didukung: BCA, MANDIRI, BRI, BNI.');
        return;
    }

    const owner_name = namarekening;

    const combinedString = username + apiKey + "deposit";
    const signature = crypto.createHash('md5').update(combinedString).digest('hex');
    const endPoint = "https://api.digiflazz.com/v1/deposit";

    const body = {
        username: username,
        amount: amount,
        bank: bank,
        owner_name: owner_name,
        sign: signature
    };

    try {
        const response = await fetch(endPoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const responseData = await response.json();
        console.log(responseData);

        if (responseData.data.rc !== "00") {
            bot.sendMessage(chatId, `Terjadi kesalahan: ${responseData.data.message}`);
            return;
        }

        let teks = `INFO DEPOSIT DIGIFLAZZ\n\n`;
        teks += `-> Jumlah Transfer : Rp ${responseData.data.amount.toLocaleString()}\n`;
        teks += `-> Berita Transfer : ${responseData.data.notes}\n\n`;
        teks += `Mohon untuk transfer sesuai dengan jumlah yang tertera!\n`;
        teks += `Catatan: Jumlah transfer (Rp ${responseData.data.amount.toLocaleString()}) hanya berlaku untuk ${hariini}.\n\n`;

        const bankDetails = {
            BCA: `Bank : BCA\nNomor Rekening : 6042888890\nNama Rekening : PT DIGIFLAZZ INTERKONEKSI INDONESIA`,
            MANDIRI: `Bank : MANDIRI\nNomor Rekening : 1550009910111\nNama Rekening : PT DIGIFLAZZ INTERKONEKSI INDONESIA`,
            BRI: `Bank : BRI\nNomor Rekening : 213501000291307\nNama Rekening : DIGIFLAZZ INTERKONEK`,
            BNI: `Bank : BNI\nNomor Rekening : 1996888992\nNama Rekening : PT DIGIFLAZZ INTERKONEKSI INDONESIA`
        };

        teks += bankDetails[bank];

        bot.sendMessage(chatId, teks);

    } catch (error) {
        console.error('Terjadi kesalahan:', error);
        bot.sendMessage(chatId, 'Terjadi kesalahan saat menghubungi API.');
    }
});

bot.onText(/\/saldodigi/, (msg) => {
    const userId = msg.from.id.toString();
    if (!owner.includes(userId)) {
        bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
        return;
    }

    const combinedString = username + apiKey + "depo";
    const signature = crypto.createHash('md5').update(combinedString).digest('hex');
    const endPoint = "https://api.digiflazz.com/v1/cek-saldo";
    const postData = {
        cmd: "deposit",
        username: username,
        sign: signature,
    };

    connect(endPoint, postData)
        .then((apiResponse) => {
            if (apiResponse && apiResponse.data) {
                const profile = apiResponse.data;
                const formatSaldo = (amount) => `Rp. ${amount.toLocaleString()}`;
                const ngen = `INFO SALDO DIGIFLAZZ\n\n» Sisa saldo : ${formatSaldo(profile.deposit)}`;
                bot.sendMessage(msg.chat.id, ngen.replace('.', '\\.'), { parse_mode: "MarkdownV2" }); // Escape '.' with '\'
            } else {
                console.log("Failed to get API data.");
            }
        })
        .catch((error) => {
            console.error("Error:", error);
            console.log("Failed to make API request.");
        });
});


bot.onText(/\/updatedigi/, async (msg) => {
    const userId = msg.from.id.toString()
    if (!owner.includes(userId)) {
        return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    const cmd = 'prepaid';
    const combinedString = username + apiKey + cmd;
    const signature = crypto.createHash('md5').update(combinedString).digest('hex');
    const endPoint = "https://api.digiflazz.com/v1/price-list";
    const postData = {
        cmd,
        username,
        sign: signature,
    };

    try {
        const apiResponse = await connect(endPoint, postData);
        if (apiResponse && apiResponse.data) {
            fs.writeFileSync(productData, JSON.stringify(apiResponse.data, null, 2));
            bot.sendMessage(msg.chat.id, `Layanan Berhasil di Update`);
        } else {
            bot.sendMessage(msg.chat.id, `Gagal mengambil data dari API.`);
        }
    } catch (error) {
        console.error('Error updating service data:', error);
        bot.sendMessage(msg.chat.id, `Terjadi kesalahan saat memperbarui layanan.`);
    }
});

bot.onText(/\/topup/, async (msg) => {
    try {
        const nomor = parseInt(msg.from.id);
        const args = msg.text.split(' ').slice(1);
        const buyer_sku_code = args[0];
        let customer_no = args.slice(1).join(' ');
        
        if (!buyer_sku_code || !customer_no) {
            bot.sendMessage(msg.chat.id, `Contoh penggunaan: /topup [kode produk] [tujuan]`);
            return;
        }

        if (buyer_sku_code.startsWith('ml') && args.length < 3) {
            bot.sendMessage(msg.chat.id, `Contoh penggunaan: /topup [kode sku] [id] [server]`);
            return;
        }

        if (buyer_sku_code.startsWith('ml')) {
            const [id, zone] = customer_no.split(' ');
            customer_no = `${id} ${zone}`;
        }

        const productData = JSON.parse(fs.readFileSync('./db/datadigi.json', 'utf8'));
        const product = productData.find((prod) => prod.buyer_sku_code.toLowerCase() === buyer_sku_code.toLowerCase());

        if (!product) {
            bot.sendMessage(msg.chat.id, `Layanan ${buyer_sku_code} Tidak ditemukan`);
            return;
        }

        const userData = JSON.parse(fs.readFileSync(pathUser));
        const userProfile = userData.find((user) => user.nomor === nomor);

        if (!userProfile) {
            bot.sendMessage(msg.chat.id, `Kamu belum terdaftar, silahkan ketik /daftar untuk bisa mengakses.`);
            return;
        }

        const originalPrice = parseFloat(product.price);
        let markupPercentage = markupConfig.default;
        if (userProfile.role) {
            if (userProfile.role === "GOLD") {
                markupPercentage = markupConfig.gold;
            } else if (userProfile.role === "PLATINUM") {
                markupPercentage = markupConfig.platinum;
            } else if (userProfile.role === "BRONZE") {
                markupPercentage = markupConfig.bronze;
            } else if (userProfile.role === "OWNER") {
                markupPercentage = markupConfig.owner;
            }
        }
        const increasedPrice = originalPrice * (1 + markupPercentage);
        const adjustedPrice = Math.round(increasedPrice);

        let ferr = '';
        if (buyer_sku_code.startsWith('ml')) {
            const [id, zone] = customer_no.split(' ');
            ferr = `https://api.isan.eu.org/nickname/ml?id=${id}&zone=${zone}`;
        } else if (buyer_sku_code.startsWith('ff')) {
            ferr = `https://api.isan.eu.org/nickname/ff?id=${customer_no}`;
        } else if (buyer_sku_code.startsWith('aov')) {
            ferr = `https://api.isan.eu.org/nickname/aov?id=${customer_no}`;
        } else if (buyer_sku_code.startsWith('codm')) {
            ferr = `https://api.isan.eu.org/nickname/cod?id=${customer_no}`;
        }

        let nickname = '';
        if (ferr) {
            try {
                const response = await fetch(ferr);
                const responseData = await response.json();

                if (responseData.success) {
                    nickname = responseData.name;
                } else {
                    bot.sendMessage(msg.chat.id, `Akun tidak ditemukan. Harap masukkan ID dengan benar!`);
                    return;
                }
            } catch (error) {
                console.error('Terjadi kesalahan:', error);
                bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat mengambil nickname.');
                return;
            }
        }

        const amount = adjustedPrice.toString();
        const url = 'https://paydisini.co.id/api/';
        const paydisiniApikey = paydisini_apikey;
        const service = "11";
        const valid_time = "1800";
        const note = "Pembelian Produk";
        const unique_code = generateUniqueRefID(8);
        const sign = md5(paydisiniApikey + unique_code + service + amount + valid_time + "NewTransaction");

        const formData = new FormData();
        formData.append('key', paydisiniApikey);
        formData.append('request', 'new');
        formData.append('unique_code', unique_code);
        formData.append('service', service);
        formData.append('amount', amount);
        formData.append('note', note);
        formData.append('valid_time', valid_time);
        formData.append('type_fee', '1');
        formData.append('signature', sign);

        try {
            const response = await axios.post(url, formData, {
                headers: formData.getHeaders()
            });

            const responseData = response.data;
            const data = responseData.data;

            const total = adjustedPrice + data.fee;
            const invoice = `── 「 STATUS TRANSAKSI 」 ──

${hariini} | ${time1}
Customer : ${msg.from.first_name}

──[ RINCIAN ]──

${product.product_name}
Tujuan : ${customer_no}
${nickname ? `Nickname: ${nickname}` : ''}
Harga : Rp ${adjustedPrice.toLocaleString()}
Fee : Rp ${data.fee}
Total : Rp ${total.toLocaleString()}

Status : Belum dibayar

Silahkan lakukan pembayaran dengan scan QR, kode berlaku selama 5 menit`;

            const qrcodeResponse = await axios({
                url: data.qrcode_url,
                responseType: 'arraybuffer'
            });

            const qrcodeBuffer = Buffer.from(qrcodeResponse.data, 'binary');
            let compressedBuffer = qrcodeBuffer;
            let quality = 80;

            while (compressedBuffer.length > 3 * 1024 * 1024 && quality > 10) {
                compressedBuffer = await sharp(qrcodeBuffer)
                    .resize({ width: 500 })
                    .jpeg({ quality })
                    .toBuffer();
                quality -= 10;
            }

            const compressedImagePath = `/tmp/${unique_code}.jpg`;
            fs.writeFileSync(compressedImagePath, compressedBuffer);

            await bot.sendPhoto(msg.chat.id, compressedImagePath, { caption: invoice });

            fs.unlinkSync(compressedImagePath);

            const startTime = Date.now();
            checkPaymentStatusOrder(msg, args, unique_code, startTime, product, customer_no, userData, nomor);

        } catch (error) {
            console.error('Terjadi kesalahan:', error);
            bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat memproses pesanan.');
        }
    } catch (error) {
        console.error('Terjadi kesalahan:', error);
        bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat memproses pesanan.');
    }
});



bot.onText(/\/order/, async (msg) => {
    const sender = parseInt(msg.from.id);
    const args = msg.text.split(' ').slice(1);
    const nomor = parseInt(msg.from.id);
    const pathUser = './db/users.json';

    try {
        const Data = JSON.parse(fs.readFileSync(pathUser));
        const userProfile = Data.find(user => user.nomor === nomor);
		const buyer_sku_code = args[0];
        let customer_no = args.slice(1).join(' ');
		
        if (!userProfile) {
            bot.sendMessage(msg.chat.id, `Kamu belum terdaftar, silahkan ketik /daftar untuk bisa mengakses`);
            return;
        }

        if (!buyer_sku_code || !customer_no) {
            bot.sendMessage(msg.chat.id, `Contoh penggunaan: /order [kode produk] [tujuan]`);
            return;
        }

        if (buyer_sku_code.startsWith('ml') && args.length < 3) {
            bot.sendMessage(msg.chat.id, `Contoh penggunaan: /order [kode sku] [id] [server]`);
            return;
        }

        if (buyer_sku_code.startsWith('ml')) {
            const [id, zone] = customer_no.split(' ');
            customer_no = `${id} ${zone}`;
        }

        const productData = JSON.parse(fs.readFileSync('./db/datadigi.json', 'utf8'));
        const product = productData.find((prod) => prod.buyer_sku_code.toLowerCase() === buyer_sku_code.toLowerCase());
        if (!product) {
            bot.sendMessage(msg.chat.id, `Layanan ${buyer_sku_code} Tidak ditemukan`);
            return;
        }

        const userData = JSON.parse(fs.readFileSync(pathUser));
        let userSaldo = userData.find((saldo) => saldo.nomor === nomor);
        if (!userSaldo || userSaldo.saldo === null) {
            bot.sendMessage(msg.chat.id, `Kamu tidak memiliki saldo, silahkan deposit`);
            return;
        }

        if (!userSaldo || userSaldo.saldo === undefined) {
            bot.sendMessage(msg.chat.id, `Kamu tidak memiliki saldo, silahkan deposit`);
            return;
        }
		
		let ferr = '';
        if (buyer_sku_code.startsWith('ml')) {
            const [id, zone] = customer_no.split(' ');
            ferr = `https://api.isan.eu.org/nickname/ml?id=${id}&zone=${zone}`;
        } else if (buyer_sku_code.startsWith('ff')) {
            ferr = `https://api.isan.eu.org/nickname/ff?id=${customer_no}`;
        } else if (buyer_sku_code.startsWith('aov')) {
            ferr = `https://api.isan.eu.org/nickname/aov?id=${customer_no}`;
        } else if (buyer_sku_code.startsWith('codm')) {
            ferr = `https://api.isan.eu.org/nickname/cod?id=${customer_no}`;
        }

        let nickname = '';
        if (ferr) {
            try {
                const response = await fetch(ferr);
                const responseData = await response.json();

                if (responseData.success) {
                    nickname = responseData.name;
                } else {
                    bot.sendMessage(msg.chat.id, `Akun tidak ditemukan. Harap masukkan ID dengan benar!`);
                    return;
                }
            } catch (error) {
                console.error('Terjadi kesalahan:', error);
                bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat mengambil nickname.');
                return;
            }
        }

        const userRole = userData.find((role) => role.nomor === nomor);
        const originalPrice = parseFloat(product.price);
        let markupPercentage = defaultMarkupPercentage;
        if (userRole) {
            if (userRole.role === "GOLD") {
                markupPercentage = markupConfig.gold;
            } else if (userRole.role === "PLATINUM") {
                markupPercentage = markupConfig.platinum;
            } else if (userRole.role === "BRONZE") {
                markupPercentage = markupConfig.bronze;
            } else if (userRole.role === "OWNER") {
                markupPercentage = markupConfig.owner;
            }
        }
        const increasedPrice = originalPrice * (1 + markupPercentage);
        const adjustedPrice = Math.round(increasedPrice);
        if (userSaldo.saldo < adjustedPrice) {
            bot.sendMessage(msg.chat.id, `Saldo kamu tidak cukup untuk melakukan transaksi ${product.product_name}`);
            return;
        }

        userSaldo.saldo -= adjustedPrice;
        fs.writeFileSync(pathUser, JSON.stringify(userData, null, 2));
        const ref_id = generateUniqueRefID(8);
        const referdf = ref_id;
        const signature = crypto.createHash("md5").update(username + apiKey + referdf).digest("hex");
        const config = {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                username: username,
                buyer_sku_code: buyer_sku_code,
                customer_no: buyer_sku_code.startsWith('ml') ? customer_no.replace(' ', '') : customer_no,
                ref_id: ref_id,
                sign: signature,
            }),
        };

        fetch("https://api.digiflazz.com/v1/transaction", config).then(async (response) => {
            const data = await response.json();

            let invo = `── 「 STATUS TRANSAKSI 」 ──\n\n`;
            invo += `Pesananmu ${product.product_name}\n`;
            invo += `Tujuan : ${customer_no}\n`;
			invo += `${nickname ? `Nickname : ${nickname}` : '-'}\n\n`;
            invo += `Sedang diproses...`;
            bot.sendMessage(msg.chat.id, invo);

            let dataStatus = data.data.status;
            while (dataStatus !== "Sukses") {
                await sleep(1000);
                const MemecLutz = await fetch("https://api.digiflazz.com/v1/transaction", config);
                const memecData = await MemecLutz.json();
                dataStatus = memecData.data.status;
                console.log(dataStatus);

                if (dataStatus === "Gagal") {
                    loadImage('./lib/gagal.png').then((background) => {
                        let canvas = createCanvas(background.width, background.height);
                        let ctx = canvas.getContext('2d');

                        ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

                        ctx.font = '30px Noto Sans';
                        ctx.fillStyle = '#fff';
                        ctx.textAlign = 'left';

                        ctx.font = 'bold 23px Noto Sans';
                        ctx.fillText(`${hariini} ${time1}`, 305, 1043);
                        ctx.font = '30px Noto Sans';
                        ctx.fillText(`${memecData.data.message}`, 32, 620);
                        ctx.font = '30px Noto Sans';
                        ctx.fillText(`${msg.from.first_name}`, 32, 372);
                        ctx.fillText(`${customer_no}`, 430, 175);
						ctx.fillText(`${nickname ? `${nickname}` : '-'}`, 430, 119);
                        ctx.fillText(`${memecData.data.ref_id}`, 317, 744);
                        ctx.font = 'bold 27px Noto Sans';
                        ctx.fillText(`${product.product_name}`, 263, 60);
                        ctx.font = '30px Noto Sans';
                        ctx.fillText(`Saldo: ${userSaldo.saldo.toLocaleString()}`, 32, 415);

                        let buffer = canvas.toBuffer();
                        bot.sendPhoto(msg.chat.id, buffer, {
                            caption: 'Transaksi gagal.'
                        });

                    }).catch((error) => {
                        console.error('Error loading background:', error);
                        bot.sendMessage(msg.chat.id, 'An error occurred while loading the background.');
                    });

                    userSaldo.saldo += adjustedPrice;
                    fs.writeFileSync(pathUser, JSON.stringify(userData, null, 2));
                    let transactions = [];
                    if (fs.existsSync("./db/trx.json")) {
                        const rawData = fs.readFileSync("./db/trx.json", "utf8");
                        transactions = JSON.parse(rawData);
                    }
                    const newTransaction = {
                        nomor: nomor,
                        status: memecData.data.status,
                        invoice: memecData.data.ref_id,
                        item: product.product_name,
                        rc: memecData.data.rc,
                        tujuan: customer_no,
                        harga: adjustedPrice,
                        waktu: `${time1} | ${hariini}`,
                    };
                    transactions.push(newTransaction);
                    fs.writeFileSync("./db/trx.json", JSON.stringify(transactions, null, 2));
                    break;
                } else if (dataStatus === "Sukses") {
                    loadImage('./lib/sukses.png').then((background) => {
                        let canvas = createCanvas(background.width, background.height);
                        let ctx = canvas.getContext('2d');

                        ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

                        ctx.font = '30px Noto Sans';
						ctx.fillStyle = '#fff';
						ctx.textAlign = 'left';

						let y = 280;
						ctx.font = 'bold 23px Noto Sans';
						ctx.fillText(`${hariini} ${time1}`, 305, 1043);

						const text = `${memecData.data.sn}`;
						const maxCharsPerLine = 35;
						let lines = [];
						let line = '';
						for (let i = 0; i < text.length; i++) {
							line += text[i];
							if ((i + 1) % maxCharsPerLine === 0 || i === text.length - 1) {
								lines.push(line);
								line = '';
							}
						}

						lines.forEach((lineText, index) => {
							ctx.fillText(lineText, 32, 620 + index * 30);
						});

						y += lines.length * 30;

						ctx.font = '30px Noto Sans';
						ctx.fillText(``, 32, 372);
						ctx.fillText(`${customer_no}`, 430, 175);
						ctx.fillText(`${nickname ? `${nickname}` : '-'}`, 430, 119);
						ctx.fillText(`${memecData.data.ref_id}`, 317, 744);
						y += 270;
						ctx.font = 'bold 27px Noto Sans';
						ctx.fillText(`${product.product_name}`, 263, 60);
						ctx.font = '30px Noto Sans';
						ctx.fillText(`Saldo : ${userSaldo.saldo.toLocaleString()}`, 32, 415);

                        let buffer = canvas.toBuffer();
                        bot.sendPhoto(msg.chat.id, buffer, {
                            caption: 'Transaksi berhasil.'
                        });

                    }).catch((error) => {
                        console.error('Error loading background:', error);
                        bot.sendMessage(msg.chat.id, 'An error occurred while loading the background.');
                    });

                    let transactions = [];
                    if (fs.existsSync("./db/trx.json")) {
                        const rawData = fs.readFileSync("./db/trx.json", "utf8");
                        transactions = JSON.parse(rawData);
                    }
                    const newTransaction = {
                        nomor: nomor,
                        status: memecData.data.status,
                        invoice: memecData.data.ref_id,
                        item: product.product_name,
                        rc: memecData.data.rc,
                        tujuan: customer_no,
                        harga: adjustedPrice,
                        waktu: `${time1} | ${hariini}`,
                    };
                    transactions.push(newTransaction);
                    fs.writeFileSync("./db/trx.json", JSON.stringify(transactions, null, 2));

                    let toOwn = `── 「 LAPORAN TRANSAKSI 」 ──\n\n`;
                    toOwn += `Nama: ${msg.from.first_name}\n`;
                    toOwn += `User ID: ${msg.from.id}\n`;
                    toOwn += `Harga Jual: Rp ${adjustedPrice.toLocaleString()}\n`;
                    toOwn += `Harga Modal: Rp ${originalPrice.toLocaleString()}\n`;
                    toOwn += `Produk: ${product.product_name}\n`;
                    toOwn += `Tujuan: ${customer_no}`;
                    setTimeout(() => {
                        bot.sendMessage(parseInt(owner), toOwn).then(() => {
                            console.log(`Pesan terkirim ke owner: ${owner}`);
                        }).catch(error => {
                            console.error(`Gagal mengirim pesan ke owner: ${owner}`, error);
                        });
                    }, 10000);
                    break;
                }
            }
        });
    } catch (error) {
        console.error(error);
        bot.sendMessage(msg.chat.id, 'Terjadi kesalahan pada server.');
    }
});

bot.onText(/\/deposit(?: (.+))?/, async (msg, match) => {
    const amount = match[1];

    if (isNaN(amount)) {
        bot.sendMessage(msg.chat.id, `Contoh penggunaan\n/deposit 10000\n\nMinimal deposit saldo otomatis adalah ${minimalDepoOtomatis}`);
        return;
    }

    const url = 'https://paydisini.co.id/api/';
    const paydisiniApikey = paydisini_apikey;
    const service = "11";
    const valid_time = "1800";
    const note = "Deposit Saldo";
    const unique_code = generateUniqueRefID(8);
    const sign = md5(paydisiniApikey + unique_code + service + amount + valid_time + "NewTransaction");

    const formData = new FormData();
    formData.append('key', paydisiniApikey);
    formData.append('request', 'new');
    formData.append('unique_code', unique_code);
    formData.append('service', service);
    formData.append('amount', amount);
    formData.append('note', note);
    formData.append('valid_time', valid_time);
    formData.append('type_fee', '1');
    formData.append('signature', sign);

    try {
        const response = await axios.post(url, formData, {
            headers: formData.getHeaders()
        });

        const responseData = response.data;
        const data = responseData.data;

        const totalBayar = parseFloat(data.amount);
        const totalDepo = parseFloat(data.balance);

        const depositSaldoBot = `[ Deposit Saldo Otomatis ]

-> Diterima : ${formatmoney(totalDepo)}
-> Fee : ${formatmoney(data.fee)}
-> Total : ${formatmoney(totalBayar)}
-> Ref Id : ${data.unique_code}

Silahkan Scan QR ini untuk melakukan pembayaran, hanya berlaku 5 menit`;

        const qrcodeResponse = await axios({
            url: data.qrcode_url,
            responseType: 'arraybuffer'
        });

        const qrcodeBuffer = Buffer.from(qrcodeResponse.data, 'binary');
        let compressedBuffer = qrcodeBuffer;
        let quality = 80;

        while (compressedBuffer.length > 3 * 1024 * 1024 && quality > 10) {
            compressedBuffer = await sharp(qrcodeBuffer)
                .resize({ width: 500 })
                .jpeg({ quality })
                .toBuffer();
            quality -= 10;
        }

        const compressedImagePath = `/tmp/${unique_code}.jpg`;
        fs.writeFileSync(compressedImagePath, compressedBuffer);

        await bot.sendPhoto(msg.chat.id, compressedImagePath, { caption: depositSaldoBot });

        fs.unlinkSync(compressedImagePath);

        const startTime = Date.now();
        checkPaymentStatusPaydisini(unique_code, startTime, msg);
    } catch (error) {
        console.error('Terjadi kesalahan:', error);
        bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat memproses permintaan. Silakan coba lagi nanti.');
    }
});


/*bot.onText(/\/games/, (msg) => {
    try {
        const productData = JSON.parse(fs.readFileSync('./db/datadigi.json', 'utf8'));
        const gamesProducts = productData.filter(item => item.category.toLowerCase() === 'games');
        const gamesBrands = [...new Set(gamesProducts.map(item => item.brand))];

        if (gamesBrands.length > 0) {
            const pushname = msg.from.first_name || msg.from.username;
            let capt = `Hallo ${pushname}\nKetik » *List <Nama Produk>*\nUntuk Melihat Harga Sesuai Produk\n\n`
            capt += `Contoh » *List Free Fire*\n`
            capt += `───────────────\n`
            capt += `${gamesBrands.join('\n')}`
            bot.sendMessage(msg.chat.id, capt);
        }
    } catch (error) {
        console.error('Error reading product data:', error);
        bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat membaca data produk.');
    }
});

bot.onText(/\/emoney/, (msg) => {
    try {
        const productData = JSON.parse(fs.readFileSync('./db/datadigi.json', 'utf8'));
        const emoneyProducts = productData.filter(item => item.category.toLowerCase() === 'e-money');
        const emoneyBrands = [...new Set(emoneyProducts.map(item => item.brand))];

        if (emoneyBrands.length > 0) {
            const pushname = msg.from.first_name || msg.from.username;
            let capt = `Hallo ${pushname}\nKetik » *List <Nama Produk>*\nUntuk Melihat Harga Sesuai Produk\n\n`
            capt += `Contoh » *List Dana*\n`
            capt += `───────────────\n`
            capt += `${emoneyBrands.join('\n')}`
            bot.sendMessage(msg.chat.id, capt);
        }
    } catch (error) {
        console.error('Error reading product data:', error);
        bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat membaca data produk.');
    }
});

bot.onText(/\/pulsa/, (msg) => {
    try {
        const productData = JSON.parse(fs.readFileSync('./db/datadigi.json', 'utf8'));
        const pulsaProducts = productData.filter(item => item.category.toLowerCase() === 'pulsa');
        const pulsaBrands = [...new Set(pulsaProducts.map(item => item.brand))];

        if (pulsaBrands.length > 0) {
            const pushname = msg.from.first_name || msg.from.username;
            let capt = `Hallo ${pushname}\nKetik » *List <Nama Produk>*\nUntuk Melihat Harga Sesuai Produk\n\n`
            capt += `Contoh » *List Indosat*\n`
            capt += `───────────────\n`
            capt += `${pulsaBrands.join('\n')}`
            bot.sendMessage(msg.chat.id, capt);
        }
    } catch (error) {
        console.error('Error reading product data:', error);
        bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat membaca data produk.');
    }
});

bot.onText(/\/pln/, (msg) => {
    try {
        const productData = JSON.parse(fs.readFileSync('./db/datadigi.json', 'utf8'));
        const plnProducts = productData.filter(item => item.category.toLowerCase() === 'pln');
        const plnBrands = [...new Set(plnProducts.map(item => item.brand))];

        if (plnBrands.length > 0) {
            const pushname = msg.from.first_name || msg.from.username;
            let capt = `Hallo ${pushname}\nKetik » *List <Nama Produk>*\nUntuk Melihat Harga Sesuai Produk\n\n`
            capt += `Contoh » *List Pln*\n`
            capt += `───────────────\n`
            capt += `${plnBrands.join('\n')}`
            bot.sendMessage(msg.chat.id, capt);
        }
    } catch (error) {
        console.error('Error reading product data:', error);
        bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat membaca data produk.');
    }
});*/

bot.onText(/\/daftar/, (msg) => {
    const target = parseInt(msg.from.id);
    let userData = [];

    if (fs.existsSync(pathUser)) {
        const rawData = fs.readFileSync(pathUser, 'utf8');
        userData = JSON.parse(rawData);
    }

    const existingUser = userData.find((user) => user.nomor === target);

    if (existingUser) {
        bot.sendMessage(msg.chat.id, `Kamu sudah terdaftar\nRole kamu adalah ${existingUser.role}`);
    } else {
        const defaultRole = 'BRONZE';
        const newUser = {
            nomor: target,
            saldo: 0,
            role: defaultRole,
        };

        userData.push(newUser);
        fs.writeFileSync(pathUser, JSON.stringify(userData, null, 2));

        bot.sendMessage(msg.chat.id, `─〔 REGISTRASI SUKSES 〕─\n\nUser ID : ${target}\nSaldo Awal : 0\nRole : BRONZE\n\nSilahkan lalukan Deposit agar bisa menggunakan fitur TopUp Otomatis`);

        const toChannel = `User baru telah mendaftar\n\nUser ID: ${target}\nRole: ${defaultRole}`;
        bot.sendMessage(channelId, toChannel);
    }
});

bot.onText(/\/me/, (msg) => {
    const userNomor = msg.from.id;
    const userData = JSON.parse(fs.readFileSync(pathUser));
    const userProfile = userData.find((user) => user.nomor === userNomor);
    if (!userProfile) bot.sendMessage(msg.chat.id, 'Silahkan daftar dahulu')
    if (userProfile) {
        const {
            nomor,
            saldo,
            role
        } = userProfile;
        const formatSaldo = (amount) => `Rp. ${amount.toLocaleString()}`;
        const profileMessage = `──〔 Profile 〕──\n\nName : ${msg.from.first_name}\nUser ID : ${nomor}\nSaldo : ${formatSaldo(saldo)}\nRole : ${role}\n\nCek riwayat transaksi mu dengan cara\nketik /cekriwayat\n\nIngin upgrade role?\nketik /upgrade`;
        bot.sendMessage(msg.chat.id, profileMessage);
    }
});

bot.onText(/\/ubahrole(?: (.+))?/, (msg, match) => {
    const userId = msg.from.id.toString()
    if (!owner.includes(userId)) {
        return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    if (!match[1]) {
        bot.sendMessage(msg.chat.id, 'Harap masukan ID-nya\ncontoh : /addsaldo 1234085 1500');
        return;
    }

    const args = match[1].split(' ');
    const target = parseInt(args[0], 10);

    const newRole = args[1];
    if (!newRole) {
        bot.sendMessage(msg.chat.id, 'Role baru tidak ditemukan.');
        return;
    }

    const validRoles = ['gold', 'platinum', 'owner', 'bronze'];
    if (!validRoles.includes(newRole.toLowerCase())) {
        bot.sendMessage(msg.chat.id, `Role ${newRole} belum tersedia\nRole yang tersedia: BRONZE, PLATINUM, GOLD, OWNER`);
        return;
    }

    let userData = [];
    if (fs.existsSync(pathUser)) {
        userData = JSON.parse(fs.readFileSync(pathUser, 'utf8'));
    }

    const targetUser = userData.find(user => user.nomor === target);
    if (!targetUser) {
        bot.sendMessage(msg.chat.id, `${target} belum terdaftar`);
        return;
    }

    const awal = targetUser.role;
    targetUser.role = newRole.toUpperCase();
    fs.writeFileSync(pathUser, JSON.stringify(userData, null, 2));
    bot.sendMessage(msg.chat.id, `──〔 UPDATE ROLE 〕──\n\nRole Awal : ${awal}\nRole Baru : ${targetUser.role}`);
});

bot.onText(/\/upgrade/, (msg) => {

    const target = msg.from.id.toString();

    let userData = [];
    if (fs.existsSync(pathUser)) {
        userData = JSON.parse(fs.readFileSync(pathUser, 'utf8'));
    }

    const targetUser = userData.find(user => user.nomor.toString() === target);
    if (!targetUser) {
        bot.sendMessage(msg.chat.id, `${target} belum terdaftar`);
        return;
    }

    const availableRoles = ['bronze', 'gold', 'platinum'];
    const currentRoleIndex = availableRoles.indexOf(targetUser.role.toLowerCase());

    if (currentRoleIndex === -1) {
        bot.sendMessage(msg.chat.id, `Role ${targetUser.role} tidak valid`);
        return;
    }

    const nextRoleIndex = currentRoleIndex + 1;
    const nextRole = availableRoles[nextRoleIndex];

    if (!nextRole) {
        bot.sendMessage(msg.chat.id, `Anda sudah tidak dapat Upgrade Role.`);
        return;
    }

    const rolePrices = {
        gold: 35000,
        platinum: 70000,
    };

    const rolePrice = rolePrices[nextRole];

    if (targetUser.saldo < rolePrice) {
        bot.sendMessage(msg.chat.id, `Maaf, saldo anda tidak cukup untuk upgrade\nRole : ${nextRole.toUpperCase()}\nHarga : Rp ${rolePrices[nextRole].toLocaleString()}`);
        return;
    }

    targetUser.saldo -= rolePrice;
    const prevRole = targetUser.role;
    targetUser.role = nextRole.toUpperCase();
    fs.writeFileSync(pathUser, JSON.stringify(userData, null, 2));

    bot.sendMessage(msg.chat.id, `──〔 UPDATE ROLE 〕──\n\nRole Awal : ${prevRole}\nRole Baru : ${targetUser.role}\n\nBerhasil melakukan upgrade role.`);
});

bot.onText(/\/addsaldo(?: (.+))?/, (msg, match) => {
    const userId = msg.from.id.toString();
    if (!owner.includes(userId)) {
        return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    if (!match[1]) {
        bot.sendMessage(msg.chat.id, 'Harap masukan ID-nya\ncontoh : /addsaldo 1234085 1500');
        return;
    }

    const args = match[1].split(' ');
    const target = args[0];

    const amountToAdd = parseFloat(args[1]);
    if (isNaN(amountToAdd) || amountToAdd <= 0) {
        bot.sendMessage(msg.chat.id, 'Nilai saldo invalid');
        return;
    }

    let userData = [];
    if (fs.existsSync(pathUser)) {
        const rawData = fs.readFileSync(pathUser, 'utf8');
        userData = JSON.parse(rawData);
    }

    const targetUser = userData.find(user => user.nomor.toString() === target.toString());
    if (!targetUser) {
        bot.sendMessage(msg.chat.id, `${target} belum terdaftar`);
        return;
    }

    const sebelum = targetUser.saldo;
    targetUser.saldo += amountToAdd;
    const akhir = targetUser.saldo;

    fs.writeFileSync(pathUser, JSON.stringify(userData, null, 2));

    const formatSaldo = (amount) => `${amount.toLocaleString()}`;
    bot.sendMessage(msg.chat.id, `───〔 Update Saldo 〕──\n\nUser ID : ${target}\nSaldo Terakhir : Rp. ${formatSaldo(sebelum)}\nSaldo Sekarang : Rp. ${formatSaldo(akhir)}\n\nCek info akunmu dengan ketik /me`);
});


bot.onText(/\/kurangsaldo(?: (.+))?/, (msg, match) => {
    const userId = msg.from.id.toString()
    if (!owner.includes(userId)) {
        return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    if (!match[1]) {
        bot.sendMessage(msg.chat.id, 'Harap masukan ID-nya\ncontoh : /kurangsaldo 1234085 1500');
        return;
    }

    const args = match[1].split(' ');
    const target = args[0];

    const amountToSubtract = parseFloat(args[1]);
    if (isNaN(amountToSubtract) || amountToSubtract <= 0) {
        bot.sendMessage(msg.chat.id, 'Nilai saldo invalid');
        return;
    }

    let userData = [];
    if (fs.existsSync(pathUser)) {
        const rawData = fs.readFileSync(pathUser, 'utf8');
        userData = JSON.parse(rawData);
    }

    const targetUser = userData.find(user => user.nomor.toString() === target.toString());
    if (!targetUser) {
        bot.sendMessage(msg.chat.id, `${target} belum terdaftar`);
        return;
    }

    const sebelum = targetUser.saldo;
    if (sebelum < amountToSubtract) {
        bot.sendMessage(msg.chat.id, `Saldo tidak cukup untuk mengurangi sebesar ${amountToSubtract}`);
        return;
    }

    targetUser.saldo -= amountToSubtract;
    const akhir = targetUser.saldo;

    fs.writeFileSync(pathUser, JSON.stringify(userData, null, 2));

    const formatSaldo = (amount) => `${amount.toLocaleString()}`;
    bot.sendMessage(msg.chat.id, `───〔 Update Saldo 〕──\n\nUser ID : ${target}\nSaldo Terakhir : Rp. ${formatSaldo(sebelum)}\nSaldo Sekarang : Rp. ${formatSaldo(akhir)}\n\nCek info akunmu dengan ketik /me`);
});

bot.onText(/\/cekriwayat/, (msg) => {
    const target = parseInt(msg.from.id);

    let rawDatas = [];
    if (fs.existsSync("./db/trx.json")) {
        rawDatas = JSON.parse(fs.readFileSync("./db/trx.json", "utf8"));
    }

    const userTransactions = rawDatas.filter(user => user.nomor === target && user.status.toLowerCase() === 'sukses');

    if (userTransactions.length === 0) {
        bot.sendMessage(msg.chat.id, 'Kamu belum melakukan transaksi.');
        return;
    }

    userTransactions.sort((a, b) => parseDate(b.waktu) - parseDate(a.waktu));

    let transactionHistory = `───〔 Riwayat Transaksi 〕──\n\n`;
    transactionHistory += `» Total Transaksi : ${userTransactions.length}\n\n`;

    userTransactions.forEach(transaction => {
        transactionHistory += `» Trx Id : ${transaction.invoice}\n`;
        transactionHistory += `» Item : ${transaction.item}\n`;
        transactionHistory += `» Status : ${transaction.status}\n`;
        transactionHistory += `» Harga : Rp. ${transaction.harga.toLocaleString()}\n`;
        transactionHistory += `» Tujuan : ${transaction.tujuan}\n`;
        transactionHistory += `» Waktu : ${transaction.waktu}\n`;
        transactionHistory += `───────────────\n`;
    });

    const MAX_MESSAGE_LENGTH = 4096;
    while (transactionHistory.length > MAX_MESSAGE_LENGTH) {
        let splitIndex = transactionHistory.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
        if (splitIndex === -1) splitIndex = MAX_MESSAGE_LENGTH;
        const part = transactionHistory.substring(0, splitIndex);
        bot.sendMessage(msg.chat.id, part);
        transactionHistory = transactionHistory.substring(splitIndex);
    }

    if (transactionHistory.length > 0) {
        bot.sendMessage(msg.chat.id, transactionHistory);
    }
});

bot.onText(/\/topuser/, (msg) => {
    let rawDatas = [];
    if (fs.existsSync("./db/trx.json")) {
        rawDatas = JSON.parse(fs.readFileSync("./db/trx.json", "utf8"));
    }

    const userOrders = rawDatas.reduce((acc, transaction) => {
        if (transaction.status.toLowerCase() === 'sukses') {
            acc[transaction.nomor] = (acc[transaction.nomor] || 0) + 1;
        }
        return acc;
    }, {});

    const sortedUsers = Object.keys(userOrders).sort((a, b) => userOrders[b] - userOrders[a]);

    if (sortedUsers.length === 0) {
        bot.sendMessage(msg.chat.id, 'Tidak ada pengguna dengan transaksi sukses.');
        return;
    }

    let topUserText = '───〔 Top Users 〕──\n\n';

    sortedUsers.forEach((user, index) => {
        topUserText += `#${index + 1} User ID : ${user}\nTotal Order: ${userOrders[user]}\n\n`;
    });

    topUserText += '───〔 Top Users 〕──';
    bot.sendMessage(msg.chat.id, topUserText);
});

bot.onText(/\/toplayanan/, (msg) => {
    let rawDatas = [];
    if (fs.existsSync("./db/trx.json")) {
        rawDatas = JSON.parse(fs.readFileSync("./db/trx.json", "utf8"));
    }

    const itemOrders = rawDatas.reduce((acc, transaction) => {
        if (transaction.status.toLowerCase() === 'sukses') {
            acc[transaction.item] = (acc[transaction.item] || 0) + 1;
        }
        return acc;
    }, {});

    const sortedItems = Object.keys(itemOrders).sort((a, b) => itemOrders[b] - itemOrders[a]);

    if (sortedItems.length === 0) {
        bot.sendMessage(msg.chat.id, 'Tidak ada layanan dengan transaksi sukses.');
        return;
    }

    let topItemText = '───〔 Top Layanan 〕──\n\n';

    sortedItems.forEach((item, index) => {
        topItemText += `#${index + 1} : ${item}\nTotal Order: ${itemOrders[item]}\n\n`;
    });

    topItemText += '───〔 Top Layanan 〕──';
    bot.sendMessage(msg.chat.id, topItemText);
});

bot.onText(/\/setmarkup(?: (.+))?/, (msg, match) => {
    const userId = msg.from.id.toString()
    if (!owner.includes(userId)) {
        return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    if (!match[1]) {
        bot.sendMessage(msg.chat.id, 'Contoh penggunaan : /setmarkup 0.04-0.03-0.02-0.01');
        return;
    }

    try {

        const text = match[1];

        const markupValues = text.split('-').map(value => parseFloat(value.trim()));

        markupConfig = {
            bronze: markupValues[0],
            gold: markupValues[1],
            platinum: markupValues[2],
            owner: markupValues[3]
        };

        fs.writeFileSync(markupFilePath, JSON.stringify(markupConfig, null, 2));

        bot.sendMessage(msg.chat.id, 'Profit berhasil diupdate.');
    } catch (error) {
        console.error('Error updating markup:', error);
        bot.sendMessage(msg.chat.id, 'Maaf, terjadi kesalahan dalam mengupdate markup.');
    }
});

bot.onText(/\/cekmarkup/, (msg) => {
    const userId = msg.from.id.toString()
    if (!owner.includes(userId)) {
        return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    try {

        let markupInfo = '── 「 Status Markup 」 ──\n\n';
        markupInfo += `Bronze : ${markupConfig.bronze}\n`;
        markupInfo += `Gold : ${markupConfig.gold}\n`;
        markupInfo += `Platinum : ${markupConfig.platinum}\n`;
        markupInfo += `Owner : ${markupConfig.owner}\n`;

        bot.sendMessage(msg.chat.id, markupInfo);
    } catch (error) {
        console.error('Error checking markup:', error);
        bot.sendMessage(msg.chat.id, 'Maaf, terjadi kesalahan dalam mengecek markup.');
    }
});

const formatSaldo = (amount) => `Rp. ${amount.toLocaleString()}`;

bot.onText(/\/user/, (msg) => {
    const userId = msg.from.id.toString()
    if (!owner.includes(userId)) {
        return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    const userData = JSON.parse(fs.readFileSync(pathUser, 'utf8'));

    if (userData.length === 0) {
        bot.sendMessage(msg.chat.id, 'No users found.');
        return;
    }

    let userList = `───〔 Daftar Member 〕──\n\n`;
    userData.forEach(user => {
        userList += `» User ID : ${user.nomor}\n`;
        userList += `» Saldo : ${formatSaldo(user.saldo)}\n`;
        userList += `» Role : ${user.role}\n\n`;
    });

    bot.sendMessage(msg.chat.id, userList);
});

bot.onText(/\/detail(?: (.+))?/, (msg, match) => {
    if (!match[1]) {
        bot.sendMessage(msg.chat.id, 'Masukan Kode SKU\nContoh : Detail ML10');
        return;
    }

    const requestedBuyerSkuCode = match[1].trim();

    const productData = JSON.parse(fs.readFileSync('./db/datadigi.json', 'utf8'));
    const product = productData.find(item => item.buyer_sku_code.toLowerCase() === requestedBuyerSkuCode.toLowerCase());

    if (!product) {
        bot.sendMessage(msg.chat.id, `Produk dengan kode SKU ${requestedBuyerSkuCode.toUpperCase()} tidak ditemukan.`);
        return;
    }

    const originalPrice = parseFloat(product.price);
    const bronzeMarkup = markupConfig.bronze;
    const platinumMarkup = markupConfig.platinum;
    const goldMarkup = markupConfig.gold;

    const bronzePrice = originalPrice * (1 + bronzeMarkup);
    const platinumPrice = originalPrice * (1 + platinumMarkup);
    const goldPrice = originalPrice * (1 + goldMarkup);
    const bronze = Math.round(bronzePrice);
    const platinum = Math.round(platinumPrice);
    const gold = Math.round(goldPrice);

    const formatSaldo = (amount) => `${amount.toLocaleString()}`;

    const formattedResponse = `──〔 ${product.brand} 〕─\n\n» Kode Produk : ${product.buyer_sku_code}\n» Item : ${product.product_name}\n» Kategori : ${product.category}\n» Brand : ${product.brand}\n» Tipe : ${product.type}\n» Harga Bronze : Rp. ${formatSaldo(bronzePrice)},-\n» Harga Platinum : Rp. ${formatSaldo(platinumPrice)},-\n» Harga Gold : Rp. ${formatSaldo(goldPrice)},-\n» Waktu Cut Off : ${product.start_cut_off} Sampai ${product.end_cut_off}\n» Deskripsi : ${product.desc}`;

    bot.sendMessage(msg.chat.id, formattedResponse);
});

bot.onText(/\/get(?: (.+))?/, (msg, match) => {
    const nomor = parseInt(msg.from.id);
    const productData = JSON.parse(fs.readFileSync('./db/datadigi.json', 'utf8'));
    const userData = JSON.parse(fs.readFileSync('./db/users.json', 'utf8'));
    const userProfile = userData.find(user => user.nomor === nomor);

    if (!userProfile) {
        bot.sendMessage(msg.chat.id, `Kamu belum terdaftar, silahkan ketik /daftar untuk bisa mengakses`);
        return;
    }

    const requestedBrand = match[1].trim().toLowerCase();
    if (!match[1]) {
        bot.sendMessage(msg.chat.id, 'Harap masukan kategori\ncontoh : /get Free Fire');
        return;
    }

    const brand = requestedBrand.toUpperCase();
    const matchingProducts = productData.filter(item => item.brand.toLowerCase() === requestedBrand);

    if (matchingProducts.length === 0) {
        bot.sendMessage(msg.chat.id, `Produk dengan brand ${brand} tidak ditemukan.`);
        return;
    }

    const {
        role
    } = userProfile;
    let markupPercentage = defaultMarkupPercentage;

    if (role === "GOLD") {
        markupPercentage = markupConfig.gold;
    } else if (role === "PLATINUM") {
        markupPercentage = markupConfig.platinum;
    } else if (role === "BRONZE") {
        markupPercentage = markupConfig.bronze;
    } else if (role === "OWNER") {
        markupPercentage = markupConfig.owner;
    }

    matchingProducts.sort((a, b) => a.price - b.price);

    let formattedResponse = `Hallo ${msg.from.first_name || msg.from.username} Role Kamu ${role}\nBerikut LIST ${brand} Untukmu\n\n`;
    formattedResponse += `Cara Beli:\n`;
    formattedResponse += `Contoh menggunakan saldo:\n/order ML10 181141484 2923\n`;
	formattedResponse += `Contoh menggunakan qris:\n/topup ML10 181141484 2923\n`;

    const maxMessageLength = 4000;

    let currentMessage = formattedResponse;
    matchingProducts.forEach(product => {
        const originalPrice = parseFloat(product.price);
        const increasedPrice = originalPrice * (1 + markupPercentage);
        const adjustedPrice = Math.round(increasedPrice);
        const formatSaldo = (amount) => `Rp. ${amount.toLocaleString()}`;

        const productInfo = `${product.product_name}\n` +
            `> Kode SKU : ${product.buyer_sku_code}\n` +
            `> Harga : ${formatSaldo(adjustedPrice)}\n` +
            `> Status : ${product.seller_product_status ? '✅ ' : '❌'}\n` +
            `-⊶-⊶-⊶-⊶-⊶-⊶-⊶-⊶-\n`;

        if ((currentMessage + productInfo).length > maxMessageLength) {

            bot.sendMessage(msg.chat.id, currentMessage);
            currentMessage = '';
        }

        currentMessage += productInfo;
    });

    if (currentMessage.length > 0) {
        bot.sendMessage(msg.chat.id, currentMessage);
    }
});

bot.onText(/\/cekml(?: (.+))?/, (msg, match) => {
(function(_0x5b0af7,_0x1bb66a){const _0x261605=_0x193d,_0x3fd274=_0x5b0af7();while(!![]){try{const _0x252872=-parseInt(_0x261605(0x130))/(0x151*0x1d+-0x1899*0x1+-0xd93)*(parseInt(_0x261605(0x15a))/(0x18d6*-0x1+0x1eef*-0x1+0x37c7))+parseInt(_0x261605(0x17b))/(0x1+-0x1ba5+0x1*0x1ba7)*(parseInt(_0x261605(0x101))/(0x1793+-0xce+-0x16c1))+-parseInt(_0x261605(0xea))/(0xae5*-0x1+0x5*0x5f2+-0x12d0)*(parseInt(_0x261605(0x132))/(-0x1da4+-0x18cb+-0x3*-0x1227))+-parseInt(_0x261605(0x150))/(-0x1*-0x18c1+-0x1226*-0x2+0x92*-0x6b)*(-parseInt(_0x261605(0x120))/(-0x5ad+0x1c78+0x1*-0x16c3))+parseInt(_0x261605(0x199))/(-0x1*-0x1f6e+0x1*-0x9d7+-0x59*0x3e)+parseInt(_0x261605(0x138))/(0x1d18+-0x1*0x1b87+-0x187)*(parseInt(_0x261605(0xe3))/(-0x1ca*0xf+-0x1*0x1364+-0x67*-0x73))+-parseInt(_0x261605(0x164))/(0x8f4+-0x4c*0x64+0x7*0x2f8);if(_0x252872===_0x1bb66a)break;else _0x3fd274['push'](_0x3fd274['shift']());}catch(_0x2eead2){_0x3fd274['push'](_0x3fd274['shift']());}}}(_0x302b,0x1*0x5f93f+-0x568d1+0x5c97e));function _0x193d(_0xc45b0,_0x3a2d21){const _0x4498e8=_0x302b();return _0x193d=function(_0x1fd50d,_0x268e85){_0x1fd50d=_0x1fd50d-(-0x2b*0xa3+0x1f77+-0x4f*0xb);let _0x447c11=_0x4498e8[_0x1fd50d];return _0x447c11;},_0x193d(_0xc45b0,_0x3a2d21);}const _0x419be8=_0x2454;(function(_0x2d1736,_0x329b26){const _0x379d8c=_0x193d,_0x6d94cf={'WCUNB':function(_0x2c2943){return _0x2c2943();},'zgQsK':function(_0x4449a4,_0x4b96d0){return _0x4449a4+_0x4b96d0;},'CTvjW':function(_0x99e195,_0x47424b){return _0x99e195+_0x47424b;},'tvcrb':function(_0x46a13f,_0x514cd9){return _0x46a13f+_0x514cd9;},'sZSWu':function(_0x345caa,_0x1ab8ea){return _0x345caa+_0x1ab8ea;},'yAwrJ':function(_0x2f4f2c,_0x41107e){return _0x2f4f2c/_0x41107e;},'OGPgG':function(_0x2d16e2,_0x6a5168){return _0x2d16e2(_0x6a5168);},'PSGNI':function(_0x443be0,_0x2745c7){return _0x443be0(_0x2745c7);},'odwca':function(_0xccf3b6,_0x327c10){return _0xccf3b6*_0x327c10;},'vZXUa':function(_0x2c7538,_0x39cb40){return _0x2c7538/_0x39cb40;},'AWcAl':function(_0x23fc18,_0x45b2df){return _0x23fc18(_0x45b2df);},'foxkM':function(_0x142dec,_0x258335){return _0x142dec+_0x258335;},'GCYrx':function(_0x2ceb0f,_0x24a6ee){return _0x2ceb0f/_0x24a6ee;},'hBtwt':function(_0x4b3dfc,_0x3efa0f){return _0x4b3dfc(_0x3efa0f);},'VNdPa':function(_0x295ce4,_0x1d9a7f){return _0x295ce4+_0x1d9a7f;},'dLzYb':function(_0x4250e5,_0x2a6021){return _0x4250e5*_0x2a6021;},'fQBiv':function(_0x19f665,_0x4aff82){return _0x19f665/_0x4aff82;},'lLDtg':function(_0x3fbf59,_0x298e8a){return _0x3fbf59(_0x298e8a);},'cvOOB':function(_0x4ff84d,_0x3414dc){return _0x4ff84d+_0x3414dc;},'SIsfK':function(_0x35b0c4,_0x1d99e2){return _0x35b0c4*_0x1d99e2;},'uLprg':function(_0x58df37,_0x18757c){return _0x58df37/_0x18757c;},'PHYsf':function(_0x13de28,_0x49493e){return _0x13de28(_0x49493e);},'pIOlf':function(_0xbd7071,_0x3b6b76){return _0xbd7071+_0x3b6b76;},'kYALC':function(_0x3b220c,_0x15ce22){return _0x3b220c/_0x15ce22;},'tgiFS':function(_0x2189ac,_0x3e042d){return _0x2189ac(_0x3e042d);},'nJpMo':function(_0x470692,_0xc23c04){return _0x470692*_0xc23c04;},'vCiWb':function(_0xebada3,_0x4c24b2){return _0xebada3*_0x4c24b2;},'jafzA':function(_0x579720,_0x29bb48){return _0x579720/_0x29bb48;},'hLFeH':function(_0x2117fb,_0x216bdc){return _0x2117fb(_0x216bdc);},'bZanm':function(_0x37f115,_0x21c5cc){return _0x37f115+_0x21c5cc;},'wfBCJ':function(_0x137a79,_0x5fe0d9){return _0x137a79+_0x5fe0d9;},'ZBoCV':function(_0x2d1eda,_0x2f1a39){return _0x2d1eda(_0x2f1a39);},'KFnwx':function(_0x29b3e4,_0x4867b4){return _0x29b3e4(_0x4867b4);},'yxRaW':function(_0x563ac2,_0x4bd4dc){return _0x563ac2+_0x4bd4dc;},'EEoZn':function(_0x288fcb,_0x2de098){return _0x288fcb*_0x2de098;},'trneA':function(_0x509b69,_0x455918){return _0x509b69/_0x455918;},'NwebI':function(_0x1d40db,_0x515ebe){return _0x1d40db(_0x515ebe);},'xEZwk':function(_0x13a92e,_0x351c9b){return _0x13a92e+_0x351c9b;},'TIIjz':function(_0x3cad9b,_0x99f9cf){return _0x3cad9b+_0x99f9cf;},'fLhGz':function(_0x5d8fd6,_0x25c734){return _0x5d8fd6*_0x25c734;},'fWtua':function(_0x2d866b,_0x3344d6){return _0x2d866b===_0x3344d6;},'BzuLT':_0x379d8c(0x198),'yCsif':_0x379d8c(0x115)},_0x29c5fb=_0x2454,_0x3ee197=_0x6d94cf[_0x379d8c(0x13e)](_0x2d1736);while(!![]){try{const _0x2e9307=_0x6d94cf[_0x379d8c(0x19e)](_0x6d94cf[_0x379d8c(0xd0)](_0x6d94cf[_0x379d8c(0x19e)](_0x6d94cf[_0x379d8c(0x180)](_0x6d94cf[_0x379d8c(0x19e)](_0x6d94cf[_0x379d8c(0x100)](_0x6d94cf[_0x379d8c(0x10d)](-_0x6d94cf[_0x379d8c(0x10a)](parseInt,_0x6d94cf[_0x379d8c(0x166)](_0x29c5fb,0x2520+0xced*-0x1+0x1748*-0x1)),_0x6d94cf[_0x379d8c(0x19e)](_0x6d94cf[_0x379d8c(0x19e)](-0x1*-0x26b+-0x1919*-0x1+0x1f*0x45,-(-0x1ac3+0x2f*0x81+-0x817*-0x4)),_0x6d94cf[_0x379d8c(0x19c)](-0x157*-0xb+0x5ea*0x2+-0x352*0x8,-(0x1e42+0x1656+-0x2e02)))),_0x6d94cf[_0x379d8c(0xe8)](_0x6d94cf[_0x379d8c(0x166)](parseInt,_0x6d94cf[_0x379d8c(0x14c)](_0x29c5fb,-0x35*0x97+0x1dbe+0x273)),_0x6d94cf[_0x379d8c(0x19e)](_0x6d94cf[_0x379d8c(0x11b)](-(-0x574*-0x2+-0x1*-0xff+0x2c5*-0x1),-(-0x1e5f+-0x117+0xb85*0x4)),-0x1292*0x2+-0x1c07*0x1+0x5*0x11c9))),_0x6d94cf[_0x379d8c(0x19c)](_0x6d94cf[_0x379d8c(0x145)](-_0x6d94cf[_0x379d8c(0x14c)](parseInt,_0x6d94cf[_0x379d8c(0x11d)](_0x29c5fb,-0x1292+0x2633+-0x12e6)),_0x6d94cf[_0x379d8c(0x18b)](_0x6d94cf[_0x379d8c(0x19e)](_0x6d94cf[_0x379d8c(0x16d)](0x437*0x3+0x9ce+0x22d,-(-0xc24+0x2623+-0x19fe)),-(0x1cd0+-0x7d*-0xe+-0x38c*0x6)),_0x6d94cf[_0x379d8c(0x19c)](-(-0x8f5+0x1*-0x739+0x1033),-(0x472*0x7+0x1041+-0x2792)))),_0x6d94cf[_0x379d8c(0x179)](-_0x6d94cf[_0x379d8c(0x166)](parseInt,_0x6d94cf[_0x379d8c(0x17d)](_0x29c5fb,0xa87+-0x1865*0x1+0xead)),_0x6d94cf[_0x379d8c(0xd0)](_0x6d94cf[_0x379d8c(0x153)](_0x6d94cf[_0x379d8c(0x177)](0x720+-0xa29+0x496,-0x24*-0x4b+0x2*-0x51a+-0x43),-0x1*0x18ca+-0x1871+0x48f2),-(0xb96*-0x5+-0x1*0x5616+0x1ba*0x74))))),_0x6d94cf[_0x379d8c(0xd8)](-_0x6d94cf[_0x379d8c(0x17d)](parseInt,_0x6d94cf[_0x379d8c(0xbe)](_0x29c5fb,-0x89*-0xb+-0x5c7+0xaa)),_0x6d94cf[_0x379d8c(0x18b)](_0x6d94cf[_0x379d8c(0xfa)](_0x6d94cf[_0x379d8c(0x16d)](-(0x12b8*0x2+0x3a1+-0x289b),-(0x2460+0x5d7+0x2a17*-0x1)),-0x1d5f*0x1+0x12dd*-0x1+-0x2ba*-0x14),-(0x2835+-0x3*-0x57e+-0x518*0x7)))),_0x6d94cf[_0x379d8c(0x19c)](_0x6d94cf[_0x379d8c(0x171)](-_0x6d94cf[_0x379d8c(0x125)](parseInt,_0x6d94cf[_0x379d8c(0x10a)](_0x29c5fb,-0x24c8+-0x29*-0xba+-0x7c7*-0x1)),_0x6d94cf[_0x379d8c(0x100)](_0x6d94cf[_0x379d8c(0x100)](_0x6d94cf[_0x379d8c(0x117)](-(0xd*0x290+0x292*0xb+-0x3d60),-(0x175d+0x746+-0x1e1a)),-(-0xb76*0x2+0x6c1+0x228e)),_0x6d94cf[_0x379d8c(0x144)](-(-0x8f7+-0x782*-0x3+-0x4*0x360),-0x19*0xc3+0xce*-0x2f+-0x8*-0x732))),_0x6d94cf[_0x379d8c(0x122)](_0x6d94cf[_0x379d8c(0x18d)](parseInt,_0x6d94cf[_0x379d8c(0x17d)](_0x29c5fb,0x4ed*-0x5+0xe9e*-0x2+-0x3*-0x1245)),_0x6d94cf[_0x379d8c(0x197)](_0x6d94cf[_0x379d8c(0x157)](-(-0x1*0x185+0xee6+0x8e5),-(-0x24d*-0x7+0x1574*0x2+-0x11dd*0x2)),-0x29cc+-0x1b3e+0x72a0)))),_0x6d94cf[_0x379d8c(0x117)](_0x6d94cf[_0x379d8c(0x10d)](-_0x6d94cf[_0x379d8c(0x161)](parseInt,_0x6d94cf[_0x379d8c(0x194)](_0x29c5fb,-0xe45+0xdbc+0x16*0x11)),_0x6d94cf[_0x379d8c(0xd0)](_0x6d94cf[_0x379d8c(0xfc)](_0x6d94cf[_0x379d8c(0x16d)](-0x1677+0x89*0x29+-0x1*-0x391,-(0x559*-0x1+0x105+-0x459*-0x1)),0x3*0x126d+-0x17b*-0x21+-0x4714),_0x6d94cf[_0x379d8c(0x19c)](-(0x7d*0x8+0x9*-0x93+0x172),-0x1871+0xe*0x1a3+0x1e8))),_0x6d94cf[_0x379d8c(0x179)](_0x6d94cf[_0x379d8c(0x14c)](parseInt,_0x6d94cf[_0x379d8c(0x14c)](_0x29c5fb,0x1b8e+0x2238+-0x3cce)),_0x6d94cf[_0x379d8c(0x157)](_0x6d94cf[_0x379d8c(0x11b)](_0x6d94cf[_0x379d8c(0x19c)](-(-0x6*0x32f+0xb66*-0x1+-0x19b*-0x13),-0xb5*-0xd+0x2b+0x277),_0x6d94cf[_0x379d8c(0x102)](0x2*-0xede+-0x206b+0x3e28*0x1,-(-0x1*-0x6d+0x71e+0x830))),_0x6d94cf[_0x379d8c(0x102)](-0x3026+-0x1f7e+0x6b3b,-0x7e7+0x1d2d+0x16b*-0xf))))),_0x6d94cf[_0x379d8c(0x154)](_0x6d94cf[_0x379d8c(0x108)](parseInt,_0x6d94cf[_0x379d8c(0xbe)](_0x29c5fb,0x1a1f+0x209d+-0x5*0xb96)),_0x6d94cf[_0x379d8c(0x174)](_0x6d94cf[_0x379d8c(0xe0)](-(0x2483+0xba*0x16+0x2*-0x10bd),0x1d7a+0x2ce+0x55b*-0x6),_0x6d94cf[_0x379d8c(0x109)](-(-0x1a35*0x1+0x99*-0x3b+0x5061),-(-0x3cb*-0x4+-0x265*0x3+-0x7fc)))));if(_0x6d94cf[_0x379d8c(0x118)](_0x2e9307,_0x329b26))break;else _0x3ee197[_0x6d94cf[_0x379d8c(0xe6)]](_0x3ee197[_0x6d94cf[_0x379d8c(0x136)]]());}catch(_0x263fc9){_0x3ee197[_0x6d94cf[_0x379d8c(0xe6)]](_0x3ee197[_0x6d94cf[_0x379d8c(0x136)]]());}}}(_0x2716,-0x155d68+-0x10d5cd+-0xc3a*-0x455+(0x44b3c+0x2*0x29887+-0x68390)+-(-0x6d754+0x2e3*0x133+0x88fab*0x1)));function _0x2454(_0x4ec8fd,_0x16d475){const _0x3c6f4f=_0x193d,_0x1bf9c5={'hhuby':function(_0x19e6a1,_0x50cd4c){return _0x19e6a1-_0x50cd4c;},'eqsqa':function(_0x3ac240,_0x283724){return _0x3ac240+_0x283724;},'jLGWZ':function(_0x1ffcd3,_0x551943){return _0x1ffcd3*_0x551943;},'kPOKj':function(_0x3a55f0){return _0x3a55f0();},'qUfXC':function(_0x376919,_0x807ace,_0x485a11){return _0x376919(_0x807ace,_0x485a11);}},_0x10ab2d=_0x1bf9c5[_0x3c6f4f(0xe5)](_0x2716);return _0x2454=function(_0x7d6e9d,_0x131605){const _0x345fc4=_0x3c6f4f;_0x7d6e9d=_0x1bf9c5[_0x345fc4(0xb8)](_0x7d6e9d,_0x1bf9c5[_0x345fc4(0x103)](_0x1bf9c5[_0x345fc4(0x103)](-(-0x2458+0x5f3+-0xb*-0x42b),-(-0x1e12+0x2e1+-0xb*-0x2af)),_0x1bf9c5[_0x345fc4(0x11e)](0xbd*-0x31+-0x1*-0x1843+0xbee,0x24*0x5b+-0xd81+0x555)));let _0x838187=_0x10ab2d[_0x7d6e9d];return _0x838187;},_0x1bf9c5[_0x3c6f4f(0xbb)](_0x2454,_0x4ec8fd,_0x16d475);}const args=match[-(0x16f*0x28+-0x21eb+0x1*0xe66)*(-0x15b*-0x1a+0x1b80+-0x3ebd)+(0x19f2+-0x2275+0xec*0x22)+(0x1566+-0x12f*-0xb+-0x71*0x2c)]?match[-(-0x102*-0x46+0x2192*-0x1+0x2*-0x61)+-(-0x22fc+-0x1*0x62+0x2f3b)+(0x2778+0x2*0x177d+-0x265c)][_0x419be8(0x2251+-0x1*0x116e+0x6f*-0x25)]('\x20'):[],id=args[(-0x5c7+0x1370+-0xc20)*-(0xeb7+-0x1*-0x1eb6+-0xc5*0x3b)+(-0x1941+-0x2*-0x29d+0x350c)+-(0x1*0x49d+0x1663+-0x13*0x2b)],zone=args[(0x1d94+0x1066+-0x225f)*(-0x17f3*-0x1+0x2325+-0x3b16)+(0x1428+0x5a4*0x2+-0x2*0x21b)+(0xe5*-0x1d+0x5d*0x62+-0x1*-0x28c6)*-(0x69a+0xd*0x2a5+-0x28fa)];function _0x302b(){const _0x14b8e0=['\x20Bang\x0a\x0aID\x20','fQBiv','TYCPr','22794HDcdNq','this_login','lLDtg','xPsbK','ba\x20lagi\x20na','tvcrb','MBvFO','23918900cO','WUDYD','wZGuL','JZMBF','lvk','Silakan\x20co','oRbZY','message','id_ID','VNdPa','aqxuQ','hLFeH','ends:\x20Bang','ucvbU','confirmati','MEkXr','uPeyk','nQdtZ','KFnwx','sLoIN','DaLEj','bZanm','push','7092153sqsthO','split','fkUIl','odwca','RYvil','zgQsK','rvwnQ','AGKdj','mBnIJ','_country','oTjEz','ZLliH','fLgOg','ijboF','fSBKi','bxLlJ','Terjadi\x20ke','ZGDZS','zyAdl','hhuby','afhUm','JJWMD','qUfXC','vZZxr','ATc','PHYsf','oQNXS','igdIu','MOBILE_LEG','1579.0','initPaymen','AhXkN','/cekml\x20<id','sendMessag','create_rol','error','3097557BzB','4mlXIFT','TBPNY','XgGMz','kWyXe','4150','catch','CTvjW','applicatio','cahrW','WMfUO','IZOqC','ENDS','LyXkz','xpoKd','uLprg','ded','formasi:\x20','XFnRe','dgWkr','ECkkT','eate\x20:\x20','xLgMz','TIIjz','cJuK','NgzLt','22oDtrzG','cqpgU','kPOKj','BzuLT','QGSqm','vZXUa','t.action','3983410NZWuoh','IoAMe','Contoh\x20pen','username','\x0aRegion\x20Cr','POST','yJlRD','onFields','XeEUR','salahan\x20sa','Mobile\x20Leg','toString','hXeex','pfuie','bPvfz','TLhSV','pIOlf','\x0aServer\x20:\x20','yxRaW','then','\x0aNickname\x20','hpibq','sZSWu','196WQwHIa','EEoZn','eqsqa','json','der-sg.cod','\x0aRegion\x20Lo','rjVHF','NwebI','fLhGz','OGPgG','lruLJ','bSGbf','yAwrJ','mzxld','gdseZ','HQTpi','WYAtX','toUpperCas','roHFC','Gagal\x20mend','shift','ozyrc','nJpMo','fWtua','enahu','iQhpG','foxkM','mXDls','hBtwt','jLGWZ','IaYZf','1787216CtiQuE','eQexI','jafzA','4468875xUC','XNidS','tgiFS','oDyhy','KaAfx','e_country','IoGZt','bmEfe','JcMqi','VsInt','GElYo','WviQY','16568zBqoa','103AQZQHf','VNhra','6vNAUGB','HtVFM','rITKC','NipzZ','yCsif','ashop.com/','1180370VCGdYJ','NoJdH','1165994Wpx','uIEvz','qTQWi','jwsAU','WCUNB','306UsmGPT','QKRXO','igMNB','Knlvd','gin\x20:\x20','vCiWb','GCYrx','success','kmT','https://or','at\x20menghub','971626WUQQ','GGuVA','AWcAl','aGzmm','doauv','vKroL','14uUoPBw','EQDNY','fmIlM','cvOOB','trneA','apatkan\x20in','ZUMcy','wfBCJ','xrAfB','\x0a\x0aAPI\x20By\x20J','11898yacanZ','ILJsh','Pwdle','YMsqs','rm-urlenco','CjVkn','chat','ZBoCV','56hpYHJx','egPyi','210384BvZMzQ','yUBYG','PSGNI','gmlFw','xwNVv','rbckO','CIWXw','hUVWz','ggunaan\x20:\x20','dLzYb','717900hjNr','ungi\x20API.\x20','nti.','kYALC','>\x20<server>','nEnLf','xEZwk','n/x-www-fo','zEcsQ','SIsfK'];_0x302b=function(){return _0x14b8e0;};return _0x302b();}if(!id||!zone){bot[_0x419be8(-0x9a4*0x3+-0x1bc2+-0xad*-0x55)+'e'](msg[_0x419be8(0x763+0x11c4+-0x185d)]['id'],_0x419be8(-0x158f+0x1*-0x14cb+0x1*0x2b22)+_0x419be8(0x1bfe+-0x1ed8+-0x10*-0x3c)+_0x419be8(0x1304*-0x1+0xd6a*0x2+-0x10*0x70)+_0x419be8(-0xfef*0x1+-0x565*0x2+0x1b8f));return;}function _0x2716(){const _0x4b8b06=_0x193d,_0x3d1352={'yJlRD':_0x4b8b06(0xc7),'xrAfB':_0x4b8b06(0x18a),'KaAfx':_0x4b8b06(0xc2),'gdseZ':_0x4b8b06(0xc9)+_0x4b8b06(0xbd),'xpoKd':_0x4b8b06(0x146),'uPeyk':_0x4b8b06(0x15e),'nEnLf':_0x4b8b06(0x112),'yUBYG':_0x4b8b06(0xcf),'IoGZt':_0x4b8b06(0x128),'XeEUR':_0x4b8b06(0xd9),'fmIlM':_0x4b8b06(0x114),'mzxld':_0x4b8b06(0xc6),'VNhra':_0x4b8b06(0x155),'rvwnQ':_0x4b8b06(0x175),'uIEvz':_0x4b8b06(0x123)+_0x4b8b06(0x186),'bPvfz':_0x4b8b06(0xde),'zEcsQ':_0x4b8b06(0xec),'XFnRe':_0x4b8b06(0x16e)+'Vr','fkUIl':_0x4b8b06(0x160),'bSGbf':_0x4b8b06(0xd5),'IoAMe':_0x4b8b06(0xc1),'cqpgU':_0x4b8b06(0xee),'AhXkN':_0x4b8b06(0x182)+_0x4b8b06(0xe1),'kWyXe':_0x4b8b06(0xca),'ucvbU':_0x4b8b06(0xc5),'igMNB':_0x4b8b06(0xc8),'fSBKi':_0x4b8b06(0xfe),'JJWMD':_0x4b8b06(0x106),'JcMqi':_0x4b8b06(0x18e),'WMfUO':_0x4b8b06(0x11c),'igdIu':_0x4b8b06(0x172),'IZOqC':_0x4b8b06(0x1a2),'cahrW':_0x4b8b06(0x19a),'bxLlJ':_0x4b8b06(0x104),'ILJsh':_0x4b8b06(0x16f),'XNidS':_0x4b8b06(0xf1),'zyAdl':_0x4b8b06(0xf3),'rbckO':_0x4b8b06(0x17f),'EQDNY':_0x4b8b06(0x170),'DaLEj':_0x4b8b06(0x187),'doauv':_0x4b8b06(0x178),'LyXkz':_0x4b8b06(0x189),'XgGMz':_0x4b8b06(0xfd),'xwNVv':_0x4b8b06(0xe9),'gmlFw':_0x4b8b06(0xff),'oDyhy':_0x4b8b06(0xf5),'ijboF':_0x4b8b06(0x16c),'TBPNY':_0x4b8b06(0xda),'xLgMz':_0x4b8b06(0x190),'MBvFO':_0x4b8b06(0xb5),'hUVWz':_0x4b8b06(0x105),'nQdtZ':_0x4b8b06(0x13a)+_0x4b8b06(0x147),'TYCPr':_0x4b8b06(0x148),'TLhSV':_0x4b8b06(0x12f)+'v','Pwdle':_0x4b8b06(0x14a)+'qh','CjVkn':_0x4b8b06(0xfb),'oRbZY':_0x4b8b06(0xef),'AGKdj':_0x4b8b06(0x143),'ozyrc':_0x4b8b06(0x162),'GElYo':_0x4b8b06(0xf4),'WYAtX':_0x4b8b06(0x159),'ZGDZS':_0x4b8b06(0xce),'JZMBF':_0x4b8b06(0xed),'MEkXr':_0x4b8b06(0x137),'NoJdH':_0x4b8b06(0x13f),'vKroL':_0x4b8b06(0xd1),'oQNXS':_0x4b8b06(0x17c),'dgWkr':_0x4b8b06(0x149),'afhUm':_0x4b8b06(0xc3),'egPyi':function(_0x19e378){return _0x19e378();}},_0x29fafb=[_0x3d1352[_0x4b8b06(0xf0)],_0x3d1352[_0x4b8b06(0x158)],_0x3d1352[_0x4b8b06(0x127)],_0x3d1352[_0x4b8b06(0x10f)],_0x3d1352[_0x4b8b06(0xd7)],_0x3d1352[_0x4b8b06(0x192)],_0x3d1352[_0x4b8b06(0x173)],_0x3d1352[_0x4b8b06(0x165)],_0x3d1352[_0x4b8b06(0x129)],_0x3d1352[_0x4b8b06(0xf2)],_0x3d1352[_0x4b8b06(0x152)],_0x3d1352[_0x4b8b06(0x10e)],_0x3d1352[_0x4b8b06(0x131)],_0x3d1352[_0x4b8b06(0x19f)],_0x3d1352[_0x4b8b06(0x13b)],_0x3d1352[_0x4b8b06(0xf8)],_0x3d1352[_0x4b8b06(0x176)],_0x3d1352[_0x4b8b06(0xdb)],_0x3d1352[_0x4b8b06(0x19b)],_0x3d1352[_0x4b8b06(0x10c)],_0x3d1352[_0x4b8b06(0xeb)],_0x3d1352[_0x4b8b06(0xe4)],_0x3d1352[_0x4b8b06(0xc4)],_0x3d1352[_0x4b8b06(0xcd)],_0x3d1352[_0x4b8b06(0x18f)],_0x3d1352[_0x4b8b06(0x141)],_0x3d1352[_0x4b8b06(0xb3)],_0x3d1352[_0x4b8b06(0xba)],_0x3d1352[_0x4b8b06(0x12b)],_0x3d1352[_0x4b8b06(0xd3)],_0x3d1352[_0x4b8b06(0xc0)],_0x3d1352[_0x4b8b06(0xd4)],_0x3d1352[_0x4b8b06(0xd2)],_0x3d1352[_0x4b8b06(0xb4)],_0x3d1352[_0x4b8b06(0x15b)],_0x3d1352[_0x4b8b06(0x124)],_0x3d1352[_0x4b8b06(0xb7)],_0x3d1352[_0x4b8b06(0x169)],_0x3d1352[_0x4b8b06(0x151)],_0x3d1352[_0x4b8b06(0x196)],_0x3d1352[_0x4b8b06(0x14e)],_0x3d1352[_0x4b8b06(0xd6)],_0x3d1352[_0x4b8b06(0xcc)],_0x3d1352[_0x4b8b06(0x168)],_0x3d1352[_0x4b8b06(0x167)],_0x3d1352[_0x4b8b06(0x126)],_0x3d1352[_0x4b8b06(0xb2)],_0x3d1352[_0x4b8b06(0xcb)],_0x3d1352[_0x4b8b06(0xdf)],_0x3d1352[_0x4b8b06(0x181)],_0x3d1352[_0x4b8b06(0x16b)],_0x3d1352[_0x4b8b06(0x193)],_0x3d1352[_0x4b8b06(0x17a)],_0x3d1352[_0x4b8b06(0xf9)],_0x3d1352[_0x4b8b06(0x15c)],_0x3d1352[_0x4b8b06(0x15f)],_0x3d1352[_0x4b8b06(0x188)],_0x3d1352[_0x4b8b06(0x1a0)],_0x3d1352[_0x4b8b06(0x116)],_0x3d1352[_0x4b8b06(0x12d)],_0x3d1352[_0x4b8b06(0x111)],_0x3d1352[_0x4b8b06(0xb6)],_0x3d1352[_0x4b8b06(0x185)],_0x3d1352[_0x4b8b06(0x191)],_0x3d1352[_0x4b8b06(0x139)],_0x3d1352[_0x4b8b06(0x14f)],_0x3d1352[_0x4b8b06(0xbf)],_0x3d1352[_0x4b8b06(0xdc)],_0x3d1352[_0x4b8b06(0xb9)]];return _0x2716=function(){return _0x29fafb;},_0x3d1352[_0x4b8b06(0x163)](_0x2716);}const endpoint=_0x419be8(0x1*0xe17+0x1edf+-0x2c0a*0x1)+_0x419be8(-0x642+0x2549+-0x1e1d)+_0x419be8(0x180b+-0x18d+0x72d*-0x3)+_0x419be8(-0x9f0*0x2+0x1632*0x1+-0x156)+_0x419be8(-0x869*-0x4+-0x1f4b+-0x176),body=new URLSearchParams({'voucherPricePoint.id':_0x419be8(-0x25a*-0xd+0x7f2+-0x258f),'voucherPricePoint.price':_0x419be8(0x2*-0x123+-0x1199+-0x1*-0x1499),'voucherPricePoint.variablePrice':'0','user.userId':id,'user.zoneId':zone,'voucherTypeName':_0x419be8(-0xb6a+0x1bf7+-0x25*0x6d)+_0x419be8(0x1fc5+-0x84*-0x26+-0x3292*0x1),'shopLang':_0x419be8(-0x1*-0x1565+-0x1df*-0x11+-0x347b),'voucherTypeId':'1','gvtId':'1'});fetch(endpoint,{'method':_0x419be8(0x54d*0x2+0x2687+-0x3031),'headers':{'Content-Type':_0x419be8(-0x2154+-0x2*-0x9e4+0xe85)+_0x419be8(-0xd+0x1c5*0x9+0x1*-0xf1b)+_0x419be8(-0x51*0x2f+-0xa3*0x6+0x33d*0x6)+_0x419be8(-0xc*-0xcc+0x60*-0x65+0x1d11)},'body':body[_0x419be8(-0xd43+-0x1324+0x214c)]()})[_0x419be8(0xe0f+-0x2523+0xbfb*0x2)](_0x3f5d0a=>_0x3f5d0a[_0x419be8(0x7*-0x4bd+0xbf*0x1d+0xc61)]())[_0x419be8(0x20b3+-0x1245+-0xd8c)](_0x1dcec7=>{const _0x4bf294=_0x193d,_0x122b79={'fLgOg':function(_0x18f225,_0x1281f2){return _0x18f225(_0x1281f2);},'xPsbK':function(_0x4f8d88,_0x41aa72){return _0x4f8d88(_0x41aa72);},'RYvil':function(_0x4265dd,_0x5346aa){return _0x4265dd+_0x5346aa;},'aGzmm':function(_0x13ada3,_0x3a606f){return _0x13ada3(_0x3a606f);},'VsInt':function(_0x53d4a5,_0x2d489e){return _0x53d4a5(_0x2d489e);},'ZLliH':function(_0x26e380,_0x8d15f9){return _0x26e380+_0x8d15f9;},'sLoIN':function(_0x990b85,_0x45c7d9){return _0x990b85+_0x45c7d9;},'ECkkT':function(_0x1a51af,_0x3f3763){return _0x1a51af+_0x3f3763;},'GGuVA':function(_0x5a8869,_0x4361cb){return _0x5a8869+_0x4361cb;},'wZGuL':function(_0x3293c2,_0xacfce2){return _0x3293c2+_0xacfce2;},'HtVFM':function(_0x33996a,_0x2e6791){return _0x33996a+_0x2e6791;},'NgzLt':function(_0xdaffaf,_0x31ebe3){return _0xdaffaf+_0x31ebe3;},'aqxuQ':function(_0x2595a2,_0x2bba96){return _0x2595a2(_0x2bba96);},'pfuie':function(_0x1750f4,_0x3d7b4d){return _0x1750f4(_0x3d7b4d);},'rITKC':function(_0x2eff61,_0x1677e5){return _0x2eff61(_0x1677e5);},'NipzZ':function(_0x437177,_0x2a410b){return _0x437177(_0x2a410b);},'HQTpi':function(_0x5489cd,_0x3b88bd){return _0x5489cd(_0x3b88bd);},'CIWXw':function(_0x2076b8,_0x4a979a){return _0x2076b8(_0x4a979a);},'enahu':function(_0x598c71,_0x23c0d9){return _0x598c71+_0x23c0d9;},'hXeex':function(_0x1ae559,_0x4d328b){return _0x1ae559(_0x4d328b);},'jwsAU':function(_0xd6ad54,_0x12a0b7){return _0xd6ad54+_0x12a0b7;},'IaYZf':function(_0x4735b2,_0x4bf25b){return _0x4735b2(_0x4bf25b);},'rjVHF':function(_0xc43002,_0x4b1c8f){return _0xc43002(_0x4b1c8f);},'lruLJ':function(_0x31e7f0,_0x4a032c){return _0x31e7f0(_0x4a032c);},'bmEfe':function(_0x621cde,_0x2bc68c){return _0x621cde(_0x2bc68c);},'WUDYD':function(_0x3dd28e,_0x4516da){return _0x3dd28e+_0x4516da;},'iQhpG':function(_0x544532,_0x490068){return _0x544532+_0x490068;},'ZUMcy':function(_0x385271,_0x38a68f){return _0x385271+_0x38a68f;},'vZZxr':function(_0x3a1ee0,_0xffb798){return _0x3a1ee0(_0xffb798);}},_0x20d9f6=_0x419be8,_0x3db334={'mXDls':function(_0x289528,_0x44f89c){const _0xd5e00d=_0x193d;return _0x122b79[_0xd5e00d(0xb1)](_0x289528,_0x44f89c);}};if(_0x1dcec7[_0x122b79[_0x4bf294(0xb1)](_0x20d9f6,-0x1150+-0x1efd*0x1+-0x3109*-0x1)]){const _0x8aa05d=_0x3db334[_0x122b79[_0x4bf294(0x17e)](_0x20d9f6,0x5*0x505+-0x1f1*0x7+-0xaad)](decodeURIComponent,_0x1dcec7[_0x122b79[_0x4bf294(0x19d)](_0x122b79[_0x4bf294(0x14d)](_0x20d9f6,-0x151b+0x24a3+-0x60*0x27),_0x122b79[_0x4bf294(0x12c)](_0x20d9f6,-0x817*0x1+0x18cc+-0xfda))][_0x122b79[_0x4bf294(0xb1)](_0x20d9f6,-0x185c+0x28*0x3e+0xfa2)]),_0x40c5ed=_0x122b79[_0x4bf294(0x1a4)](_0x122b79[_0x4bf294(0x1a4)](_0x122b79[_0x4bf294(0x1a4)](_0x122b79[_0x4bf294(0x19d)](_0x122b79[_0x4bf294(0x1a4)](_0x122b79[_0x4bf294(0x195)](_0x122b79[_0x4bf294(0xdd)](_0x122b79[_0x4bf294(0x14b)](_0x122b79[_0x4bf294(0xdd)](_0x122b79[_0x4bf294(0x184)](_0x122b79[_0x4bf294(0x1a4)](_0x122b79[_0x4bf294(0x133)](_0x122b79[_0x4bf294(0xe2)](_0x122b79[_0x4bf294(0x14d)](_0x20d9f6,0x3f6+0x1460+-0x1*0x1763),_0x122b79[_0x4bf294(0x18c)](_0x20d9f6,-0x1*0x95f+0x70+0x9c3)),_0x122b79[_0x4bf294(0xf7)](_0x20d9f6,0x1c20+-0xb7b+-0xfc5)),':\x20'),id),_0x122b79[_0x4bf294(0x134)](_0x20d9f6,-0x2474*0x1+0x20*0x8e+0x1*0x13a3)),zone),_0x122b79[_0x4bf294(0xe2)](_0x122b79[_0x4bf294(0x135)](_0x20d9f6,-0x105e+0x3*-0x7e7+0x28e5),':\x20')),_0x8aa05d),_0x122b79[_0x4bf294(0x195)](_0x122b79[_0x4bf294(0x110)](_0x20d9f6,-0x2*-0x1292+-0x2fb+0xa*-0x356),_0x122b79[_0x4bf294(0x16a)](_0x20d9f6,0x2*-0x30b+0x673*-0x2+0x13c3))),_0x1dcec7[_0x122b79[_0x4bf294(0x119)](_0x122b79[_0x4bf294(0xf6)](_0x20d9f6,-0x1583+-0x1ed+0x1858),_0x122b79[_0x4bf294(0xb1)](_0x20d9f6,-0x1*-0xed5+-0x1445*-0x1+-0x223f))][_0x122b79[_0x4bf294(0xe2)](_0x122b79[_0x4bf294(0x135)](_0x20d9f6,-0x7d6+0xf3*-0x1b+0x222f),_0x122b79[_0x4bf294(0x18c)](_0x20d9f6,0x1ceb+0x545+-0x10*0x217))][_0x122b79[_0x4bf294(0x13d)](_0x122b79[_0x4bf294(0x16a)](_0x20d9f6,0x1580+-0xa24+-0xa9e),'e')]()),_0x122b79[_0x4bf294(0x19d)](_0x122b79[_0x4bf294(0xf7)](_0x20d9f6,0x1b81+0x222c+-0x1*0x3cda),_0x122b79[_0x4bf294(0x16a)](_0x20d9f6,-0x1*-0xfe5+-0x6aa+-0x84a))),_0x1dcec7[_0x122b79[_0x4bf294(0x14b)](_0x122b79[_0x4bf294(0x11f)](_0x20d9f6,0x638+0x1eb*-0x2+-0x17a),_0x122b79[_0x4bf294(0x107)](_0x20d9f6,-0x1a50+0x1*0xfd4+0xb57))][_0x122b79[_0x4bf294(0x133)](_0x122b79[_0x4bf294(0x10b)](_0x20d9f6,0x18ee+-0x221c*-0x1+-0x3a10),_0x122b79[_0x4bf294(0x14d)](_0x20d9f6,-0x761*-0x4+0x2653*0x1+0x2180*-0x2))][_0x122b79[_0x4bf294(0x19d)](_0x122b79[_0x4bf294(0x12c)](_0x20d9f6,-0x13cd+-0x282*-0xa+0x1b*-0x2b),'e')]()),_0x122b79[_0x4bf294(0x133)](_0x122b79[_0x4bf294(0x12a)](_0x20d9f6,0x1173+-0xb*-0x3e+-0x1329),'F'));bot[_0x122b79[_0x4bf294(0x1a4)](_0x122b79[_0x4bf294(0x12c)](_0x20d9f6,-0x1a5+-0x146f+0x16d7),'e')](msg[_0x122b79[_0x4bf294(0x14d)](_0x20d9f6,-0x1b9a+-0xa*0x246+0x3320)]['id'],_0x40c5ed);}else bot[_0x122b79[_0x4bf294(0x183)](_0x122b79[_0x4bf294(0x135)](_0x20d9f6,-0x14b6+-0x1dc3+0x333c),'e')](msg[_0x122b79[_0x4bf294(0x17e)](_0x20d9f6,0x734+0x198*0x10+-0x26*0xd7)]['id'],_0x122b79[_0x4bf294(0x1a4)](_0x122b79[_0x4bf294(0x11a)](_0x122b79[_0x4bf294(0x156)](_0x122b79[_0x4bf294(0x14d)](_0x20d9f6,-0x220e+0x12fb*0x2+-0xd*0x3e),_0x122b79[_0x4bf294(0xbc)](_0x20d9f6,-0x1c7*-0xa+0x11f*-0x1d+0x3f*0x3f)),_0x122b79[_0x4bf294(0xf7)](_0x20d9f6,-0x8b7+-0x37e+0xd1c)),_0x1dcec7[_0x122b79[_0x4bf294(0x135)](_0x20d9f6,-0x542*0x2+-0x1a*0x7d+-0x7*-0x371)]));})[_0x419be8(0x1*0x18f0+-0x1*0x13d7+0x1*-0x45a)](_0x28a652=>{const _0x2bc649=_0x193d,_0x4a2040={'mBnIJ':function(_0x3f4f08,_0x61cf28){return _0x3f4f08+_0x61cf28;},'Knlvd':function(_0xdc6ca,_0x3252d4){return _0xdc6ca+_0x3252d4;},'oTjEz':function(_0x48ba10,_0x55cfdf){return _0x48ba10+_0x55cfdf;},'QGSqm':function(_0x523478,_0x1433ab){return _0x523478(_0x1433ab);},'roHFC':function(_0x51dc9c,_0x517558){return _0x51dc9c(_0x517558);},'QKRXO':function(_0x39174b,_0x5eab31){return _0x39174b(_0x5eab31);},'WviQY':function(_0x50a357,_0x8d9533){return _0x50a357(_0x8d9533);},'qTQWi':function(_0x3503c3,_0x3096ba){return _0x3503c3(_0x3096ba);},'eQexI':function(_0x12358d,_0x45b48d){return _0x12358d+_0x45b48d;},'YMsqs':function(_0x43e550,_0x2eff15){return _0x43e550(_0x2eff15);}},_0xf94c5e=_0x419be8,_0x2c3dd4={'hpibq':_0x4a2040[_0x2bc649(0x1a1)](_0x4a2040[_0x2bc649(0x142)](_0x4a2040[_0x2bc649(0x142)](_0x4a2040[_0x2bc649(0x142)](_0x4a2040[_0x2bc649(0x142)](_0x4a2040[_0x2bc649(0x1a3)](_0x4a2040[_0x2bc649(0xe7)](_0xf94c5e,-0xc71+0x1*-0xc20+0x197a),_0x4a2040[_0x2bc649(0xe7)](_0xf94c5e,-0x124b+-0x23f8+0x371f)),_0x4a2040[_0x2bc649(0xe7)](_0xf94c5e,0x1222+-0x1c99+0xb72)),_0x4a2040[_0x2bc649(0x113)](_0xf94c5e,-0x11d7*0x1+0x124d*-0x1+0x24fe*0x1)),_0x4a2040[_0x2bc649(0xe7)](_0xf94c5e,-0xcd1+0x839+0x577)),_0x4a2040[_0x2bc649(0x140)](_0xf94c5e,-0x7d2+-0x5*-0x2d5+-0x57a*0x1)),_0x4a2040[_0x2bc649(0x12e)](_0xf94c5e,-0x522*0x3+0xb1*-0x1+-0x10f5*-0x1))};console[_0x4a2040[_0x2bc649(0x13c)](_0xf94c5e,0x26c1+0x17be+-0xc56*0x5)](_0x28a652),bot[_0x4a2040[_0x2bc649(0x121)](_0x4a2040[_0x2bc649(0x13c)](_0xf94c5e,0x231a*-0x1+0x10f7+-0x3b*-0x52),'e')](msg[_0x4a2040[_0x2bc649(0x15d)](_0xf94c5e,-0xf52+0x1a04+-0x9e8)]['id'],_0x2c3dd4[_0x4a2040[_0x2bc649(0x13c)](_0xf94c5e,0x1e2f+-0xc9d*-0x1+-0x29e8)]);});
});

bot.onText(/\/cekff(?: (.+))?/, (msg, match) => {
(function(_0x23eabc,_0x399df7){const _0x47134e=_0x2879,_0xec4b68=_0x23eabc();while(!![]){try{const _0xe4ccdd=parseInt(_0x47134e(0x229))/(-0xa7+0x2da+0x2*-0x119)+parseInt(_0x47134e(0x22e))/(0x1c07+-0x7*0x2c1+-0x8be)*(-parseInt(_0x47134e(0x25c))/(-0x2*0x5f+-0x1ed8+-0x1f99*-0x1))+parseInt(_0x47134e(0x1cc))/(-0xb2d*-0x1+-0xcb6*-0x2+-0x2495)*(-parseInt(_0x47134e(0x1e5))/(0x1c7+-0x1*-0x1782+-0x1944))+parseInt(_0x47134e(0x1fb))/(0x2673+-0x38a*0x7+-0xda7)+parseInt(_0x47134e(0x24c))/(-0x2023+0x1380+0xcaa)*(-parseInt(_0x47134e(0x20a))/(0x1193+-0x14a2+-0x317*-0x1))+parseInt(_0x47134e(0x1db))/(0xa*-0x272+0x1*0x269f+-0xe22)*(parseInt(_0x47134e(0x21d))/(0x2*0x1a3+0xae8+0x389*-0x4))+parseInt(_0x47134e(0x261))/(-0x7b*0x2d+0x3*0x8a0+-0x436);if(_0xe4ccdd===_0x399df7)break;else _0xec4b68['push'](_0xec4b68['shift']());}catch(_0x45bc5d){_0xec4b68['push'](_0xec4b68['shift']());}}}(_0x4eac,-0x2bfb+0x3b835+-0x1c*-0xd3f));const _0x559030=_0x4081;(function(_0x4fc9a2,_0x14e277){const _0x538261=_0x2879,_0x5831c6={'tYGki':function(_0x32353b){return _0x32353b();},'CyISB':function(_0x1b2738,_0x22d257){return _0x1b2738+_0x22d257;},'ZkTZu':function(_0x5a397c,_0x4ab616){return _0x5a397c+_0x4ab616;},'cqChO':function(_0x92243f,_0x15a0ad){return _0x92243f+_0x15a0ad;},'OmOaJ':function(_0x52677d,_0x58df66){return _0x52677d*_0x58df66;},'uImzo':function(_0x24cea9,_0x14d5de){return _0x24cea9/_0x14d5de;},'NSIER':function(_0x5b21c7,_0xd5c86d){return _0x5b21c7(_0xd5c86d);},'vPRKm':function(_0x4ec72f,_0x2e1938){return _0x4ec72f(_0x2e1938);},'LLqRY':function(_0x44964d,_0x53d0ee){return _0x44964d+_0x53d0ee;},'MPCTV':function(_0x3bfc42,_0x50f896){return _0x3bfc42+_0x50f896;},'TGfac':function(_0x2badb0,_0x157ba8){return _0x2badb0(_0x157ba8);},'GCxAC':function(_0x4cc81b,_0x53a03f){return _0x4cc81b(_0x53a03f);},'rQZiA':function(_0x1d853b,_0x2942a2){return _0x1d853b*_0x2942a2;},'zGEmG':function(_0x1b54ac,_0x5c47e9){return _0x1b54ac(_0x5c47e9);},'FGrBU':function(_0x56a0e0,_0x49a8e8){return _0x56a0e0(_0x49a8e8);},'igdBH':function(_0x303328,_0x1df900){return _0x303328+_0x1df900;},'EbuPx':function(_0x31a593,_0x43b1eb){return _0x31a593(_0x43b1eb);},'bSlSV':function(_0x2b0beb,_0xf58dfb){return _0x2b0beb+_0xf58dfb;},'iQNts':function(_0x2607ce,_0xd3d4b9){return _0x2607ce+_0xd3d4b9;},'OYikO':function(_0x14e724,_0x2e66e7){return _0x14e724/_0x2e66e7;},'HQLjq':function(_0x261c4e,_0x56d79e){return _0x261c4e(_0x56d79e);},'HnyEC':function(_0x2ce8b4,_0x16e173){return _0x2ce8b4*_0x16e173;},'yBlOs':function(_0x54ce55,_0x1aeb18){return _0x54ce55/_0x1aeb18;},'SaMpx':function(_0x37fb60,_0xc72c80){return _0x37fb60(_0xc72c80);},'eFYpm':function(_0x49ba7a,_0x3c31ba){return _0x49ba7a(_0x3c31ba);},'TlJry':function(_0x4bcf94,_0x1695c5){return _0x4bcf94+_0x1695c5;},'BofZn':function(_0x5259d3,_0x3986cd){return _0x5259d3*_0x3986cd;},'kGLlo':function(_0x173021,_0x33c5ff){return _0x173021/_0x33c5ff;},'EYLfl':function(_0x50810d,_0x3d0b82){return _0x50810d(_0x3d0b82);},'bbomZ':function(_0x138372,_0x47f38b){return _0x138372+_0x47f38b;},'fSPqh':function(_0x340004,_0x52410f){return _0x340004+_0x52410f;},'FFwSy':function(_0x23a93c,_0x141927){return _0x23a93c*_0x141927;},'doqbV':function(_0xa3b5af,_0x2647d8){return _0xa3b5af*_0x2647d8;},'pqqHu':function(_0x5a2617,_0x2da072){return _0x5a2617(_0x2da072);},'YNrkK':function(_0x27d0ac,_0x52e3bf){return _0x27d0ac(_0x52e3bf);},'RrJEm':function(_0x40d408,_0x379d7d){return _0x40d408+_0x379d7d;},'qKwYD':function(_0x3879ff,_0x588ca4){return _0x3879ff*_0x588ca4;},'CqOzU':function(_0x1bc3af,_0x498411){return _0x1bc3af+_0x498411;},'VXofp':function(_0x5c3839,_0x21aad9){return _0x5c3839*_0x21aad9;},'vpXSo':function(_0x4f89e7,_0x2310e2){return _0x4f89e7*_0x2310e2;},'eFOyu':function(_0x5d18ee,_0x354705){return _0x5d18ee/_0x354705;},'jSwHo':function(_0x558de1,_0x5aa2f5){return _0x558de1(_0x5aa2f5);},'rZDMD':function(_0x3a85a0,_0xea61c0){return _0x3a85a0+_0xea61c0;},'JevMB':function(_0x27057f,_0x5892d6){return _0x27057f*_0x5892d6;},'xCjjG':function(_0x2d5df7,_0x269416){return _0x2d5df7/_0x269416;},'TVnje':function(_0x445c82,_0x174d3f){return _0x445c82(_0x174d3f);},'ADpxn':function(_0x2e6b54,_0x5138cf){return _0x2e6b54+_0x5138cf;},'jkBKL':function(_0x51d11d,_0x21b8f8){return _0x51d11d*_0x21b8f8;},'oIzke':function(_0x45e038,_0x2b1d53){return _0x45e038===_0x2b1d53;},'aDiRN':_0x538261(0x225),'DWBed':_0x538261(0x274)},_0x245413=_0x4081,_0x4b643f=_0x5831c6[_0x538261(0x207)](_0x4fc9a2);while(!![]){try{const _0xfb6948=_0x5831c6[_0x538261(0x219)](_0x5831c6[_0x538261(0x1cb)](_0x5831c6[_0x538261(0x22d)](_0x5831c6[_0x538261(0x22d)](_0x5831c6[_0x538261(0x219)](_0x5831c6[_0x538261(0x219)](_0x5831c6[_0x538261(0x200)](_0x5831c6[_0x538261(0x272)](_0x5831c6[_0x538261(0x1eb)](parseInt,_0x5831c6[_0x538261(0x1c6)](_0x245413,0x26bc+-0x1e83+-0x70d)),_0x5831c6[_0x538261(0x1ee)](_0x5831c6[_0x538261(0x26a)](0x2768+0x1*0x581+0x1*-0x10c9,0x79*-0x4+-0x9*0xdf+0xd56),-(0xe2*0x3+0x115+0x955*0x3))),_0x5831c6[_0x538261(0x272)](-_0x5831c6[_0x538261(0x277)](parseInt,_0x5831c6[_0x538261(0x1d9)](_0x245413,-0x1*0x1b14+-0x24b*-0x3+-0x3*-0x729)),_0x5831c6[_0x538261(0x1cb)](_0x5831c6[_0x538261(0x1cb)](0x5d*0x47+-0x7f2+-0x430,0x11c0+0xb4e+-0x654),_0x5831c6[_0x538261(0x200)](-(0xa3c+-0x48*0x49+0xa4d),0x6d+-0x2601+-0x49f5*-0x1)))),_0x5831c6[_0x538261(0x234)](_0x5831c6[_0x538261(0x272)](-_0x5831c6[_0x538261(0x26d)](parseInt,_0x5831c6[_0x538261(0x243)](_0x245413,-0x15a4+0x1e47+-0x773)),_0x5831c6[_0x538261(0x1cf)](_0x5831c6[_0x538261(0x1ee)](-(-0x211+0x22*-0xd2+0x2188),-(-0xde6+-0x25bd*-0x1+0x1292*-0x1)),0x565*-0x3+0xebe+0xa4c)),_0x5831c6[_0x538261(0x272)](-_0x5831c6[_0x538261(0x1dd)](parseInt,_0x5831c6[_0x538261(0x243)](_0x245413,0xc8e+0x714+-0x1265)),_0x5831c6[_0x538261(0x1dc)](_0x5831c6[_0x538261(0x280)](_0x5831c6[_0x538261(0x234)](0xdab*0x1+-0x1*0x3b9+-0x8e2,-(0x254f*0x1+0x13*-0x4f+-0x2*0xfa7)),-(-0x9f7*0x1+0x12ad*0x3+-0x11f1)),-0x5ccd*-0x1+0x1*0x5486+-0x6ef0)))),_0x5831c6[_0x538261(0x287)](-_0x5831c6[_0x538261(0x1d7)](parseInt,_0x5831c6[_0x538261(0x1d9)](_0x245413,-0x731*0x3+0x1*0x1b2d+0x227*-0x2)),_0x5831c6[_0x538261(0x1dc)](_0x5831c6[_0x538261(0x219)](-0x143a+0x3ee*0x1+-0x16ba*-0x1,_0x5831c6[_0x538261(0x286)](-0x5c2+-0x2659+0x2c66,-(0x9*0x2ef+0x1*-0x207d+0x659))),0x36d*0x1+-0x2*-0x227+0x57d))),_0x5831c6[_0x538261(0x286)](_0x5831c6[_0x538261(0x1f1)](_0x5831c6[_0x538261(0x1cd)](parseInt,_0x5831c6[_0x538261(0x214)](_0x245413,0x16d5+0x13*-0x18d+0x7e7)),_0x5831c6[_0x538261(0x1dc)](_0x5831c6[_0x538261(0x23e)](_0x5831c6[_0x538261(0x286)](-(0x2037+0xab3*0x2+0x1cfd*-0x1),0x2d*-0x7b+0x29*0x3e+0xbb2),_0x5831c6[_0x538261(0x256)](0x185f+0xa*0x25a+0x189*-0x1d,-(0x16c+0x149a+-0x73*0x31))),_0x5831c6[_0x538261(0x234)](-(0x7ef+0x3d*0x35+-0x1488),-(0x5a7*0x1+0x2461+0x4*-0x96c)))),_0x5831c6[_0x538261(0x217)](_0x5831c6[_0x538261(0x254)](parseInt,_0x5831c6[_0x538261(0x1d7)](_0x245413,0x24cf*0x1+-0x6b*0x1a+-0x18b0)),_0x5831c6[_0x538261(0x1fd)](_0x5831c6[_0x538261(0x21e)](0x1*0x1afa+-0x1*-0xa67+-0x1271*0x1,_0x5831c6[_0x538261(0x275)](-0x1a*0xe7+0x559*-0x3+0x2d36,0x200d*0x1+-0x22f9+0x2f2)),_0x5831c6[_0x538261(0x25e)](-(0x6d6+0x26*0xea+0x1*-0x2991),-0x209*-0x13+-0x1abd+0x2939))))),_0x5831c6[_0x538261(0x287)](-_0x5831c6[_0x538261(0x289)](parseInt,_0x5831c6[_0x538261(0x27b)](_0x245413,0x1933+0x187c+0x1*-0x3071)),_0x5831c6[_0x538261(0x27d)](_0x5831c6[_0x538261(0x22d)](0x1d23+0x2*0xf75+-0x2b22,_0x5831c6[_0x538261(0x26e)](-(0x2350+-0x1*0xc93+-0x16bc),0x3d6+0x398*0xc+-0x187d)),_0x5831c6[_0x538261(0x275)](-(0x14a3+0x94e+0x1*-0x1ddb),-(0x886+-0xf25+0x6e0))))),_0x5831c6[_0x538261(0x272)](-_0x5831c6[_0x538261(0x277)](parseInt,_0x5831c6[_0x538261(0x1eb)](_0x245413,-0xb97+0x1430+-0x23*0x35)),_0x5831c6[_0x538261(0x1de)](_0x5831c6[_0x538261(0x21e)](_0x5831c6[_0x538261(0x1e3)](-0x1f33+-0x11a3+0x30df,-(-0x1f40+0x1893+0x41b*0x2)),-(0x3*0x579+-0x1*0x2053+0x2499)),-0x1b*-0x159+-0x476*0xa+0x2ac4))),_0x5831c6[_0x538261(0x22f)](_0x5831c6[_0x538261(0x204)](-_0x5831c6[_0x538261(0x1d7)](parseInt,_0x5831c6[_0x538261(0x279)](_0x245413,0x35*0x23+-0x1da5*-0x1+-0x23bc)),_0x5831c6[_0x538261(0x262)](_0x5831c6[_0x538261(0x26a)](_0x5831c6[_0x538261(0x1d1)](-(-0xcd5+0x1*-0xc41+0x34e3),0x1*-0x11ed+0x1e43+0xc55*-0x1),_0x5831c6[_0x538261(0x286)](-(0x1233+-0x18d7+0x955*0x1),0xd*0x263+-0x2242+0x348)),-0x2407+0x3d12+0x25c9)),_0x5831c6[_0x538261(0x205)](-_0x5831c6[_0x538261(0x232)](parseInt,_0x5831c6[_0x538261(0x26d)](_0x245413,0x5*-0x5f0+0x35*-0xb+0x2141)),_0x5831c6[_0x538261(0x24a)](_0x5831c6[_0x538261(0x1cf)](_0x5831c6[_0x538261(0x22a)](-(-0x15f*0xf+-0x1*-0x12d6+-0x4*-0x71),-(-0x1504+0x1900+0x6d*-0x7)),-(0x2b81+0xa06*0x1+0x3cd*-0x5)),0x212b*-0x1+-0x213b+0x2df7*0x2))));if(_0x5831c6[_0x538261(0x239)](_0xfb6948,_0x14e277))break;else _0x4b643f[_0x5831c6[_0x538261(0x212)]](_0x4b643f[_0x5831c6[_0x538261(0x285)]]());}catch(_0x39505d){_0x4b643f[_0x5831c6[_0x538261(0x212)]](_0x4b643f[_0x5831c6[_0x538261(0x285)]]());}}}(_0x1e75,-(-0x6a6e6+0x2b082*0x2+0x1*0x5648e)+-(-0x4*0x7cf+0x3543+-0x1118*-0x4)*-(-0x1e46+0xb7+-0x9*-0x34a)+(-0xd10e6+-0x4c26*0x7+0x1e52aa)));const args=match[-(0x20b*0xe+-0xd1e+-0x23)*(-0x767*0x3+-0x25*0x7c+-0x1d3*-0x16)+(-0x35ec+-0x214e*-0x1+0x32b4)*-(-0xe9b+0x135d+-0x1*0x4c1)+(0x1ff6+0x1adb+-0x4*0xeb4)*(0x27cd*-0x1+-0x32d*-0x6+0x422f)]?match[(0x54a*-0x1+0x1030+0xaa9)*(0x1820+-0x1ca6+0x3d*0x13)+-(0x911+0x41*0x61+-0x21b1)*-(0x10bd+0xa*-0x6d+-0xb7d*-0x1)+-(-0x3403*0x1+-0x2b*-0x165+0x643*0x6)][_0x559030(-0x2a5*0x9+0x1dca+0xd*-0x5c)]('\x20'):[],id=args[-(-0x1*-0x965+0x62c+0xe65)+-(0x2b5+0x1*0xb4e+-0xdcf)*-(0x1d2e+-0x133*0x1+-0xf1*0x1d)+-(-0x206f+-0x63*0x3d+-0x28*-0x189)];if(!id){bot[_0x559030(0x22a*-0xf+-0x7fc+-0x14e*-0x20)+'e'](msg[_0x559030(-0xbe*-0x7+-0x602*0x5+0x4*0x687)]['id'],_0x559030(-0x174+0x7*-0x275+-0x13df*-0x1)+_0x559030(0x1*-0x19df+0x123d*-0x1+0x2d65)+_0x559030(-0x1cc8+0x164f+-0x3d1*-0x2)+'>');return;}function _0x1e75(){const _0x4b5b88=_0x2879,_0x34bb1c={'sPGKH':_0x4b5b88(0x228),'aRgbP':_0x4b5b88(0x25b)+_0x4b5b88(0x220),'GSlex':_0x4b5b88(0x21c),'Dbfxx':_0x4b5b88(0x1f9),'qEsAS':_0x4b5b88(0x27e),'gJCYI':_0x4b5b88(0x28a),'cxeey':_0x4b5b88(0x231),'keiZJ':_0x4b5b88(0x1d4),'jppoi':_0x4b5b88(0x218)+_0x4b5b88(0x288),'BMbKi':_0x4b5b88(0x1f3),'VfbXK':_0x4b5b88(0x1ff),'pWboH':_0x4b5b88(0x223)+'r','fjzRx':_0x4b5b88(0x1fc),'swztr':_0x4b5b88(0x20c),'kUJBY':_0x4b5b88(0x244),'Nvsbg':_0x4b5b88(0x246)+_0x4b5b88(0x20b),'KWfSt':_0x4b5b88(0x26f),'kCBBQ':_0x4b5b88(0x1ca),'bGCoW':_0x4b5b88(0x28b),'zkljf':_0x4b5b88(0x21b),'ZZFiH':_0x4b5b88(0x241),'tfAEF':_0x4b5b88(0x1ea),'wwfvX':_0x4b5b88(0x1f8),'YnWKX':_0x4b5b88(0x291),'tjSyr':_0x4b5b88(0x27c),'kNHqM':_0x4b5b88(0x247),'tPKwT':_0x4b5b88(0x26c),'ESyFm':_0x4b5b88(0x28c),'UptMQ':_0x4b5b88(0x264),'lRmmL':_0x4b5b88(0x1e7)+_0x4b5b88(0x227),'lfLhE':_0x4b5b88(0x22b),'yHlru':_0x4b5b88(0x266),'hweYM':_0x4b5b88(0x23a),'nTlxU':_0x4b5b88(0x292),'IMqzY':_0x4b5b88(0x1f0),'pTFmT':_0x4b5b88(0x1d0)+'Ts','NziUe':_0x4b5b88(0x1e4),'ntnYK':_0x4b5b88(0x1f4),'FMLOZ':_0x4b5b88(0x27f),'CCrlW':_0x4b5b88(0x224),'cqGnB':_0x4b5b88(0x25a),'vzKTk':_0x4b5b88(0x206),'QgKwb':_0x4b5b88(0x1fa),'tOBkD':_0x4b5b88(0x281)+_0x4b5b88(0x270),'rspyX':_0x4b5b88(0x1e6),'vJlxd':_0x4b5b88(0x1ce),'YqpWV':_0x4b5b88(0x290),'QqcEl':_0x4b5b88(0x25f),'hqxDy':_0x4b5b88(0x28f),'PpKin':_0x4b5b88(0x20f),'MBywi':_0x4b5b88(0x221),'rRIWa':_0x4b5b88(0x1da),'DNEBz':_0x4b5b88(0x23b),'SXLTw':_0x4b5b88(0x271),'rBDla':_0x4b5b88(0x1c8),'sVeFK':_0x4b5b88(0x236),'qHSXk':function(_0x9ee972){return _0x9ee972();}},_0x288a93=[_0x34bb1c[_0x4b5b88(0x273)],_0x34bb1c[_0x4b5b88(0x22c)],_0x34bb1c[_0x4b5b88(0x257)],_0x34bb1c[_0x4b5b88(0x278)],_0x34bb1c[_0x4b5b88(0x260)],_0x34bb1c[_0x4b5b88(0x1d6)],_0x34bb1c[_0x4b5b88(0x263)],_0x34bb1c[_0x4b5b88(0x269)],_0x34bb1c[_0x4b5b88(0x1c9)],_0x34bb1c[_0x4b5b88(0x233)],_0x34bb1c[_0x4b5b88(0x201)],_0x34bb1c[_0x4b5b88(0x21f)],_0x34bb1c[_0x4b5b88(0x213)],_0x34bb1c[_0x4b5b88(0x28d)],_0x34bb1c[_0x4b5b88(0x1d2)],_0x34bb1c[_0x4b5b88(0x268)],_0x34bb1c[_0x4b5b88(0x208)],_0x34bb1c[_0x4b5b88(0x1f6)],_0x34bb1c[_0x4b5b88(0x242)],_0x34bb1c[_0x4b5b88(0x216)],_0x34bb1c[_0x4b5b88(0x23c)],_0x34bb1c[_0x4b5b88(0x1ec)],_0x34bb1c[_0x4b5b88(0x284)],_0x34bb1c[_0x4b5b88(0x209)],_0x34bb1c[_0x4b5b88(0x23d)],_0x34bb1c[_0x4b5b88(0x238)],_0x34bb1c[_0x4b5b88(0x265)],_0x34bb1c[_0x4b5b88(0x20d)],_0x34bb1c[_0x4b5b88(0x235)],_0x34bb1c[_0x4b5b88(0x24e)],_0x34bb1c[_0x4b5b88(0x237)],_0x34bb1c[_0x4b5b88(0x1d3)],_0x34bb1c[_0x4b5b88(0x293)],_0x34bb1c[_0x4b5b88(0x23f)],_0x34bb1c[_0x4b5b88(0x230)],_0x34bb1c[_0x4b5b88(0x1c7)],_0x34bb1c[_0x4b5b88(0x215)],_0x34bb1c[_0x4b5b88(0x1e8)],_0x34bb1c[_0x4b5b88(0x203)],_0x34bb1c[_0x4b5b88(0x211)],_0x34bb1c[_0x4b5b88(0x210)],_0x34bb1c[_0x4b5b88(0x24d)],_0x34bb1c[_0x4b5b88(0x24b)],_0x34bb1c[_0x4b5b88(0x1f5)],_0x34bb1c[_0x4b5b88(0x251)],_0x34bb1c[_0x4b5b88(0x28e)],_0x34bb1c[_0x4b5b88(0x282)],_0x34bb1c[_0x4b5b88(0x24f)],_0x34bb1c[_0x4b5b88(0x1df)],_0x34bb1c[_0x4b5b88(0x267)],_0x34bb1c[_0x4b5b88(0x249)],_0x34bb1c[_0x4b5b88(0x202)],_0x34bb1c[_0x4b5b88(0x1fe)],_0x34bb1c[_0x4b5b88(0x276)],_0x34bb1c[_0x4b5b88(0x253)],_0x34bb1c[_0x4b5b88(0x1e0)]];return _0x1e75=function(){return _0x288a93;},_0x34bb1c[_0x4b5b88(0x1ed)](_0x1e75);}const endpoint=_0x559030(0x8da+0x1354+-0x1adc)+_0x559030(0x99b*0x2+-0x1a1c+0x836*0x1)+_0x559030(0x13f6+-0x5f0*0x4+-0x4ff*-0x1)+_0x559030(-0x3*-0x575+0x2587+-0x34a0)+_0x559030(0xf8*-0x13+0x196c+-0x5d6),body=new URLSearchParams({'voucherPricePoint.id':_0x559030(0x2*-0xb57+-0x1dad+0x35b3),'voucherPricePoint.price':_0x559030(0x125d+-0x1e95*0x1+0xd6f),'voucherPricePoint.variablePrice':'0','user.userId':id,'voucherTypeName':_0x559030(-0x123c+-0x520*-0x7+-0x106a),'shopLang':_0x559030(0x1*0x1619+-0x11cd+-0x31d),'voucherTypeId':'1','gvtId':'1'});function _0x4081(_0x45abdd,_0x27661d){const _0x7de86b=_0x2879,_0x4c118d={'mFHvi':function(_0x11ccf5,_0x21ef8b){return _0x11ccf5-_0x21ef8b;},'zcosy':function(_0x32dba6,_0x1231dd){return _0x32dba6+_0x1231dd;},'YVrtJ':function(_0x48765f,_0x24c4f5){return _0x48765f*_0x24c4f5;},'YcIeA':function(_0x5b885a){return _0x5b885a();},'JdKta':function(_0x3988e7,_0x246f66,_0x35ec51){return _0x3988e7(_0x246f66,_0x35ec51);}},_0x26652f=_0x4c118d[_0x7de86b(0x258)](_0x1e75);return _0x4081=function(_0x34c139,_0x4f1051){const _0x3e6ba4=_0x7de86b;_0x34c139=_0x4c118d[_0x3e6ba4(0x1f7)](_0x34c139,_0x4c118d[_0x3e6ba4(0x248)](_0x4c118d[_0x3e6ba4(0x248)](-0x2f*-0x53+-0x11e7+-0x4*-0x26a,_0x4c118d[_0x3e6ba4(0x240)](0x9*0x81+0x91+0xcd5,-(0x8f7+0x1*0x270d+-0x5*0x99a))),0xe7*-0x35+0x2*0x1b1e+0x179e));let _0x17bcd7=_0x26652f[_0x34c139];return _0x17bcd7;},_0x4c118d[_0x7de86b(0x27a)](_0x4081,_0x45abdd,_0x27661d);}function _0x2879(_0x1cf890,_0x530d64){const _0x52bc07=_0x4eac();return _0x2879=function(_0x449923,_0x595643){_0x449923=_0x449923-(-0x1*0xe12+-0x665+-0x163d*-0x1);let _0x4a291e=_0x52bc07[_0x449923];return _0x4a291e;},_0x2879(_0x1cf890,_0x530d64);}function _0x4eac(){const _0x4f3558=['dKN','pqqHu','ba\x20lagi\x20na','POST','8050','swztr','vJlxd','ashop.com/','role','\x0aUser\x20ID\x20:','ungi\x20API.\x20','hweYM','SLnGi','vJbfM','vPRKm','pTFmT','Silakan\x20co','jppoi','sendMessag','ZkTZu','4TgYpSP','SaMpx','onFields','igdBH','979910FZqC','JevMB','kUJBY','yHlru','chat','qTsGr','gJCYI','HQLjq','OlkSI','GCxAC','Contoh\x20pen','5337BXthNS','bSlSV','EbuPx','CqOzU','hqxDy','sVeFK','VToAK','wjQCF','VXofp','/cekff\x20<id','319730YBHWfy','nti.','6803568lWA','ntnYK','AmoOD','https://or','NSIER','tfAEF','qHSXk','LLqRY','Yycdv','AGbFS','yBlOs','AKgbE','initPaymen','n/x-www-fo','tOBkD','kCBBQ','mFHvi','roles','error','id_ID','678906voeERd','ggunaan\x20:\x20','bbomZ','DNEBz','ded','OmOaJ','VfbXK','rRIWa','FMLOZ','eFOyu','xCjjG','t.action','tYGki','KWfSt','YnWKX','762136YTNhzL','PzR','275WOychp','ESyFm','VGkKL','wvqAI','cqGnB','CCrlW','aDiRN','fjzRx','eFYpm','NziUe','zkljf','kGLlo','1683654BSi','CyISB','RuUER','der-sg.cod','success','3170qwkbvw','fSPqh','pWboH','Kwz','1000.0','kCfnj','60046UsQCt','27GLawzy','push','qnQVE','nMJ','4LLrwpE','156957hareIM','jkBKL','then','aRgbP','cqChO','370niJYUi','vpXSo','IMqzY','toString','TVnje','BMbKi','rQZiA','UptMQ','\x0aNickname\x20','lfLhE','kNHqM','oIzke','confirmati','errorMsg','ZZFiH','tjSyr','TlJry','nTlxU','YVrtJ','split','bGCoW','FGrBU','salahan\x20sa','mpMvN','5471990QTP','catch','zcosy','MBywi','ADpxn','QgKwb','35eCvMvm','vzKTk','lRmmL','QqcEl','gdqEg','rspyX','QGZkH','rBDla','EYLfl','yJfrq','BofZn','GSlex','YcIeA','nziYH','at\x20menghub','4806240XkA','8796rkhwVh','RBIgb','doqbV','rm-urlenco','qEsAS','10472726YrPZTT','rZDMD','cxeey','Free\x20Fire\x0a','tPKwT','json','PpKin','Nvsbg','keiZJ','MPCTV','dnqLS','Terjadi\x20ke','zGEmG','qKwYD','\x0a\x0aAPI\x20By\x20J','YSd','FREEFIRE','uImzo','sPGKH','shift','FFwSy','SXLTw','TGfac','Dbfxx','jSwHo','JdKta','YNrkK','Error\x20:\x20','RrJEm','7xqGalF','applicatio','iQNts','4531302ZUw','YqpWV','mEWzZ','wwfvX','DWBed','HnyEC','OYikO'];_0x4eac=function(){return _0x4f3558;};return _0x4eac();}fetch(endpoint,{'method':_0x559030(-0x275*0xd+-0x13c*-0x2+0x1*0x1ec8),'headers':{'Content-Type':_0x559030(-0x3*0xabd+0x20c6+0x9c)+_0x559030(0x3fd+0x2*0xce1+-0x1c95)+_0x559030(0x7*0x38d+0x3*-0xd5+-0x54a*0x4)+_0x559030(-0xe24+-0x19e*-0x17+0x1*-0x15c7)},'body':body[_0x559030(0x260f*-0x1+-0xa91+-0x63*-0x81)]()})[_0x559030(0x8b7+-0xb73+0x417)](_0x50d9f4=>_0x50d9f4[_0x559030(-0x1384+0x36d*0x2+-0x167*-0xa)]())[_0x559030(0xb*-0x121+0x1356+-0x164*0x4)](_0x54340b=>{const _0x334975=_0x2879,_0x457a2b={'VToAK':function(_0x3fac08,_0x22dc89){return _0x3fac08(_0x22dc89);},'vJbfM':function(_0x19b0c0,_0x59c475){return _0x19b0c0(_0x59c475);},'OlkSI':function(_0x478ecb,_0x45cd96){return _0x478ecb+_0x45cd96;},'RBIgb':function(_0x468a41,_0x295af1){return _0x468a41(_0x295af1);},'nziYH':function(_0x45d568,_0x48ee83){return _0x45d568*_0x48ee83;},'wjQCF':function(_0x41e9f7,_0x512bdd){return _0x41e9f7+_0x512bdd;},'AKgbE':function(_0x3d3f50,_0x2a04a4){return _0x3d3f50+_0x2a04a4;},'yJfrq':function(_0x1c0035,_0xbe770c){return _0x1c0035+_0xbe770c;},'mpMvN':function(_0x9c5857,_0x1285ea){return _0x9c5857+_0x1285ea;},'gdqEg':function(_0x35a82f,_0x470997){return _0x35a82f(_0x470997);},'SLnGi':function(_0x4f59e6,_0x5e1c0c){return _0x4f59e6+_0x5e1c0c;},'RuUER':function(_0x247b4c,_0x5b87f4){return _0x247b4c(_0x5b87f4);},'Yycdv':function(_0x20604b,_0x1fec90){return _0x20604b+_0x1fec90;},'QGZkH':function(_0x3d89e0,_0x2b0095){return _0x3d89e0+_0x2b0095;}},_0x1564b6=_0x559030,_0x77c02f={'wvqAI':function(_0x37f5aa,_0x24981e){const _0x5df4d8=_0x2879;return _0x457a2b[_0x5df4d8(0x1e1)](_0x37f5aa,_0x24981e);}};if(_0x54340b[_0x457a2b[_0x334975(0x295)](_0x1564b6,0x288+0x743*0x4+-0x1e55)]){const _0x49bd5b=_0x77c02f[_0x457a2b[_0x334975(0x295)](_0x1564b6,0x83e*0x2+0x5*-0x721+0x145f)](decodeURIComponent,_0x54340b[_0x457a2b[_0x334975(0x1d8)](_0x457a2b[_0x334975(0x25d)](_0x1564b6,0x962+-0x187d*0x1+0x1078),_0x457a2b[_0x334975(0x25d)](_0x1564b6,-0x6ec+0x5db+-0x3*-0xc1))][_0x457a2b[_0x334975(0x1e1)](_0x1564b6,-0xfb3*-0x1+-0x486+-0x9da)][_0x457a2b[_0x334975(0x1d8)](_0x457a2b[_0x334975(0x1d8)](_0x457a2b[_0x334975(0x259)](-(0x6ad+-0xe15+0x7bf),0x3*0xd5+0x30*0x70+-0x52*0x49),-(-0x265a+-0x2fe5+0xa6*0xac)),_0x457a2b[_0x334975(0x259)](-(0x1c9a+-0x20e9+0x15e1),-(0x55*0x25+-0x1917+0xcd0)))][_0x457a2b[_0x334975(0x295)](_0x1564b6,0x1633*0x1+0x1*-0xdbb+-0x1*0x745)]),_0x3c7e58=_0x457a2b[_0x334975(0x1d8)](_0x457a2b[_0x334975(0x1d8)](_0x457a2b[_0x334975(0x1e2)](_0x457a2b[_0x334975(0x1f2)](_0x457a2b[_0x334975(0x255)](_0x457a2b[_0x334975(0x245)](_0x457a2b[_0x334975(0x295)](_0x1564b6,0x1a2d*0x1+0x3*0x990+-0x3584),_0x457a2b[_0x334975(0x25d)](_0x1564b6,0xe*-0x1a+-0x1ddc+0x209c)),'\x20'),id),_0x457a2b[_0x334975(0x1f2)](_0x457a2b[_0x334975(0x25d)](_0x1564b6,0x19ab+-0x1025+-0x84a),':\x20')),_0x49bd5b),_0x457a2b[_0x334975(0x1f2)](_0x457a2b[_0x334975(0x250)](_0x1564b6,0x237d+0x1*0x1eb6+-0x40e6),'F'));bot[_0x457a2b[_0x334975(0x294)](_0x457a2b[_0x334975(0x250)](_0x1564b6,0x3*-0xb68+0xc82+0xb82*0x2),'e')](msg[_0x457a2b[_0x334975(0x21a)](_0x1564b6,0x54c+0x152d+-0x1935)]['id'],_0x3c7e58);}else bot[_0x457a2b[_0x334975(0x1ef)](_0x457a2b[_0x334975(0x1e1)](_0x1564b6,-0x714+-0x1*0xc61+-0x1*-0x14c3),'e')](msg[_0x457a2b[_0x334975(0x21a)](_0x1564b6,0x6a7*-0x1+-0x13*-0x189+-0x1540)]['id'],_0x457a2b[_0x334975(0x252)](_0x457a2b[_0x334975(0x1e1)](_0x1564b6,-0x8*-0x49e+0xd*-0x289+-0x2a6),_0x54340b[_0x457a2b[_0x334975(0x295)](_0x1564b6,-0x17e9+0x1269+0x6b9*0x1)]));})[_0x559030(0x230b+-0xdfa+0x1*-0x13bb)](_0x3f6790=>{const _0x502529=_0x2879,_0xd894d4={'kCfnj':function(_0xcecc9,_0x69f852){return _0xcecc9+_0x69f852;},'dnqLS':function(_0x462439,_0x47298d){return _0x462439(_0x47298d);},'qTsGr':function(_0xbf53da,_0x5e6012){return _0xbf53da(_0x5e6012);},'mEWzZ':function(_0x421418,_0x571a52){return _0x421418(_0x571a52);},'qnQVE':function(_0x20bf61,_0x55115e){return _0x20bf61(_0x55115e);},'AmoOD':function(_0x3184a,_0x317743){return _0x3184a(_0x317743);},'VGkKL':function(_0x4b05b1,_0x19f4e8){return _0x4b05b1(_0x19f4e8);}},_0x29cea0=_0x559030,_0x282697={'AGbFS':_0xd894d4[_0x502529(0x222)](_0xd894d4[_0x502529(0x222)](_0xd894d4[_0x502529(0x222)](_0xd894d4[_0x502529(0x222)](_0xd894d4[_0x502529(0x222)](_0xd894d4[_0x502529(0x222)](_0xd894d4[_0x502529(0x26b)](_0x29cea0,0x1bbe*0x1+-0x3*0x299+0x4*-0x4a7),_0xd894d4[_0x502529(0x26b)](_0x29cea0,-0x198+-0x93*-0xb+0x36e*-0x1)),_0xd894d4[_0x502529(0x26b)](_0x29cea0,0xc*-0x17f+-0x2*-0x537+0x8b3)),_0xd894d4[_0x502529(0x26b)](_0x29cea0,0x1344+-0x2a*-0x59+-0x340*0xa)),_0xd894d4[_0x502529(0x26b)](_0x29cea0,-0x1cdf+-0xbd8+0x29f2)),_0xd894d4[_0x502529(0x1d5)](_0x29cea0,-0x101f*0x1+0x79*-0x1b+0x1e24)),_0xd894d4[_0x502529(0x283)](_0x29cea0,-0x1a9+-0x1f9d+-0x3*-0xb7d))};console[_0xd894d4[_0x502529(0x1d5)](_0x29cea0,0x69d+0x1*-0x1a4a+0x14ed)](_0x3f6790),bot[_0xd894d4[_0x502529(0x222)](_0xd894d4[_0x502529(0x226)](_0x29cea0,-0x16*0x18+0xe*-0x11+0x44c),'e')](msg[_0xd894d4[_0x502529(0x1e9)](_0x29cea0,-0x92*-0x32+0xd*0x1e9+0xc7*-0x43)]['id'],_0x282697[_0xd894d4[_0x502529(0x20e)](_0x29cea0,-0x119*0xf+0x81+0x151*0xd)]);});
});

bot.onText(/\/cekaov(?: (.+))?/, (msg, match) => {
(function(_0x512019,_0x5aaf68){const _0xf64c09=_0x1791,_0x56ef31=_0x512019();while(!![]){try{const _0x311568=-parseInt(_0xf64c09(0x1c6))/(-0x1fc7*0x1+-0x4*0x31a+0x65*0x70)+parseInt(_0xf64c09(0xf0))/(-0x13b9+-0x21d4+0x358f*0x1)+-parseInt(_0xf64c09(0x107))/(0x25be+0x1b90+-0x5*0xd0f)+-parseInt(_0xf64c09(0x1cb))/(0x11b*0x4+-0x1c6f+0x1807)*(parseInt(_0xf64c09(0x198))/(0x72e*-0x2+0x2*0x27f+0x963))+-parseInt(_0xf64c09(0x152))/(0x2051*0x1+0x1d45+-0x3d90)*(parseInt(_0xf64c09(0x1c2))/(0x193c+0x133*0x11+-0x2d98))+-parseInt(_0xf64c09(0xec))/(-0x1df4+-0xc09+0x2a05)+-parseInt(_0xf64c09(0x10d))/(-0x148b+0x1030+0x232*0x2)*(-parseInt(_0xf64c09(0x19e))/(0x1*-0x2231+-0x35*-0x16+0x1dad));if(_0x311568===_0x5aaf68)break;else _0x56ef31['push'](_0x56ef31['shift']());}catch(_0x48e546){_0x56ef31['push'](_0x56ef31['shift']());}}}(_0x50e4,0x7f*0x2fb7+0x12aa94+-0x3b*0x7a1b));const _0x1f19c7=_0x58ca;(function(_0x5ce490,_0xb4038d){const _0x4be194=_0x1791,_0x4d6d8b={'wGkJp':function(_0x19e6e2){return _0x19e6e2();},'aoMiE':function(_0x46679a,_0x5bf924){return _0x46679a+_0x5bf924;},'DOERC':function(_0x36005d,_0x37185d){return _0x36005d+_0x37185d;},'YgShN':function(_0x30c686,_0x49bd6d){return _0x30c686+_0x49bd6d;},'aTVAy':function(_0x34c35a,_0x42ccb7){return _0x34c35a/_0x42ccb7;},'VQddT':function(_0xd2473f,_0x24330){return _0xd2473f(_0x24330);},'CNeOX':function(_0x23bb8b,_0x2654ab){return _0x23bb8b(_0x2654ab);},'SSIsj':function(_0x2fa3a7,_0x24c1a0){return _0x2fa3a7*_0x24c1a0;},'uDbZz':function(_0x501823,_0x25b76f){return _0x501823(_0x25b76f);},'hBxhN':function(_0x1cc9cf,_0x50c96e){return _0x1cc9cf+_0x50c96e;},'sgBGo':function(_0x1b9e74,_0x422051){return _0x1b9e74*_0x422051;},'ClqCU':function(_0x177c91,_0x36e02b){return _0x177c91(_0x36e02b);},'PeyCX':function(_0x875445,_0x232105){return _0x875445+_0x232105;},'LAYuN':function(_0x40b70f,_0x392a37){return _0x40b70f*_0x392a37;},'iNQqa':function(_0x545b1f,_0x1132e1){return _0x545b1f+_0x1132e1;},'SLwDF':function(_0x1fb9fa,_0x15ca44){return _0x1fb9fa*_0x15ca44;},'JzZhy':function(_0x467413,_0x3521d0){return _0x467413(_0x3521d0);},'JfbFj':function(_0x50fe2b,_0x12588c){return _0x50fe2b+_0x12588c;},'vZHAE':function(_0x1c4b2b,_0x4d3c79){return _0x1c4b2b+_0x4d3c79;},'MyZZl':function(_0x2ed761,_0x407748){return _0x2ed761*_0x407748;},'nsqyx':function(_0x357b15,_0x26b492){return _0x357b15*_0x26b492;},'ShQEX':function(_0x1b28f4,_0x4cb702){return _0x1b28f4/_0x4cb702;},'RUPUk':function(_0x2ca944,_0x2e65cf){return _0x2ca944(_0x2e65cf);},'KbkYS':function(_0xbb14a7,_0x20f931){return _0xbb14a7/_0x20f931;},'dIXaf':function(_0x5e3dc1,_0x484179){return _0x5e3dc1+_0x484179;},'gJBXr':function(_0x131170,_0x36e69a){return _0x131170*_0x36e69a;},'DQclJ':function(_0x19c6b7,_0x36ca50){return _0x19c6b7*_0x36ca50;},'RTgUG':function(_0x3dcd4b,_0x34c7a4){return _0x3dcd4b*_0x34c7a4;},'JtcSX':function(_0x178c65,_0x331572){return _0x178c65(_0x331572);},'XFuxT':function(_0x34f582,_0x41f034){return _0x34f582*_0x41f034;},'meCsz':function(_0x1c860e,_0x296d9f){return _0x1c860e+_0x296d9f;},'syKCC':function(_0x437087,_0x2eb976){return _0x437087*_0x2eb976;},'LulWR':function(_0x11be61,_0x75d061){return _0x11be61*_0x75d061;},'XcKFx':function(_0x30c0ae,_0x2b8286){return _0x30c0ae===_0x2b8286;},'JdVjP':_0x4be194(0x1be),'PofbN':_0x4be194(0x130)},_0x2312b3=_0x58ca,_0x1658be=_0x4d6d8b[_0x4be194(0x16d)](_0x5ce490);while(!![]){try{const _0x3af8e1=_0x4d6d8b[_0x4be194(0x18a)](_0x4d6d8b[_0x4be194(0x18a)](_0x4d6d8b[_0x4be194(0x18a)](_0x4d6d8b[_0x4be194(0x18a)](_0x4d6d8b[_0x4be194(0x17d)](_0x4d6d8b[_0x4be194(0x15e)](_0x4d6d8b[_0x4be194(0x128)](-_0x4d6d8b[_0x4be194(0x115)](parseInt,_0x4d6d8b[_0x4be194(0x1c0)](_0x2312b3,0x25*0xbe+0x1*0x16a9+0x2*-0x18a9)),_0x4d6d8b[_0x4be194(0x17d)](_0x4d6d8b[_0x4be194(0x17d)](0x2405+-0x7ff+0x51e,-0xb4e+0x3b9+0x23*0x61),_0x4d6d8b[_0x4be194(0xf7)](-(-0x36d*0x3+0x2dd+0x975),0x1199*-0x1+0x1*-0x2276+-0x1*-0x3422))),_0x4d6d8b[_0x4be194(0x128)](-_0x4d6d8b[_0x4be194(0x1c1)](parseInt,_0x4d6d8b[_0x4be194(0x1c1)](_0x2312b3,-0xde9+-0x1a3b+0x28f5)),_0x4d6d8b[_0x4be194(0x18a)](_0x4d6d8b[_0x4be194(0xf9)](_0x4d6d8b[_0x4be194(0xf7)](-0x419+0x1*-0x2511+-0x8f9*-0x5,-(-0x7f*0x3a+-0x1*-0xb02+0x11c5)),-(0xdd3+-0x4*-0x954+-0x223a)),_0x4d6d8b[_0x4be194(0xf7)](-(-0x12fe+-0x1*0x1707+0x1*0x2a22),-(-0x175f+-0x12e7*-0x1+-0x6*-0xdd))))),_0x4d6d8b[_0x4be194(0x19f)](_0x4d6d8b[_0x4be194(0x128)](-_0x4d6d8b[_0x4be194(0x1c0)](parseInt,_0x4d6d8b[_0x4be194(0x132)](_0x2312b3,-0x131*-0x1b+0x1fa0+0x3f01*-0x1)),_0x4d6d8b[_0x4be194(0x1a2)](_0x4d6d8b[_0x4be194(0x17d)](_0x4d6d8b[_0x4be194(0x118)](-0x1*0x4eb+-0x5*-0x1a5+-0x2ce,-(0x8a*-0x17+-0xbf3+0x3*0x81e)),0x3672+0x1*0x31be+-0x2353*0x2),_0x4d6d8b[_0x4be194(0x118)](0x2ed+-0x1*-0xd9a+-0x9ec,-(-0x3*0x2c0+-0x1b25+0x2*0x11b5)))),_0x4d6d8b[_0x4be194(0x128)](_0x4d6d8b[_0x4be194(0x1c1)](parseInt,_0x4d6d8b[_0x4be194(0x1c0)](_0x2312b3,0x3*-0x481+-0x1e8c+0x2cc8)),_0x4d6d8b[_0x4be194(0x1a2)](_0x4d6d8b[_0x4be194(0x1a4)](-(-0x9db+-0x1*0x97+-0xc*-0x2a8),-0x21b9+0xc5*-0x29+-0x1013*-0x5),-0xc9f+-0x1c2a+0x2f22)))),_0x4d6d8b[_0x4be194(0x181)](_0x4d6d8b[_0x4be194(0x128)](-_0x4d6d8b[_0x4be194(0x1c1)](parseInt,_0x4d6d8b[_0x4be194(0x111)](_0x2312b3,-0x19a0+-0x1656+0x30a9)),_0x4d6d8b[_0x4be194(0xf6)](_0x4d6d8b[_0x4be194(0x17e)](_0x4d6d8b[_0x4be194(0x118)](-0x27c*-0xb+0x2e7*-0x8+0xeb1,-(0xfa3*0x1+-0x283+-0xd1f*0x1)),-(-0x3f*-0x60+-0x16*-0x1c+0xcb*0x10)),_0x4d6d8b[_0x4be194(0x14c)](-0x101*-0x12+0x11*0x77+0x2c*-0x97,0x4ec+0x2c1*0x3+-0xb*0x27))),_0x4d6d8b[_0x4be194(0x128)](-_0x4d6d8b[_0x4be194(0x115)](parseInt,_0x4d6d8b[_0x4be194(0x1c0)](_0x2312b3,0x841+-0x1*0x269f+-0xf9e*-0x2)),_0x4d6d8b[_0x4be194(0xf9)](_0x4d6d8b[_0x4be194(0xf6)](-(-0x1*0x172f+0x1165*0x1+-0x12*-0x151),_0x4d6d8b[_0x4be194(0x12a)](-(0x23ea+0x25c0+-0x49a8),-(-0x4d*-0x9+-0x1d85*-0x1+-0x18b2))),0x213*0x9+0x1b61+-0x2b2e)))),_0x4d6d8b[_0x4be194(0xf7)](_0x4d6d8b[_0x4be194(0x1a0)](_0x4d6d8b[_0x4be194(0x1c1)](parseInt,_0x4d6d8b[_0x4be194(0x146)](_0x2312b3,0x1*0x29e+-0x6fc+0x1*0x51c)),_0x4d6d8b[_0x4be194(0x15e)](_0x4d6d8b[_0x4be194(0xf6)](-(-0x1b3b+0x2f9+0x1df3),0x58a*0x3+0x200c+0xa3*-0x28),-(0x15ca*-0x1+0xc8*-0x16+0x3874))),_0x4d6d8b[_0x4be194(0x128)](-_0x4d6d8b[_0x4be194(0x111)](parseInt,_0x4d6d8b[_0x4be194(0x1c1)](_0x2312b3,0x256f+0x613*-0x1+0x33*-0x9a)),_0x4d6d8b[_0x4be194(0x18a)](_0x4d6d8b[_0x4be194(0xf6)](-(-0x2149+-0x313*-0x6+0x16f*0x15),-(-0x817*-0x1+-0x14ee+0x2250)),-0x556*0x1+-0x1228+-0x1*-0x3c43)))),_0x4d6d8b[_0x4be194(0x17f)](_0x4d6d8b[_0x4be194(0x1c1)](parseInt,_0x4d6d8b[_0x4be194(0x1c1)](_0x2312b3,-0x97*-0x21+0x1f17+-0x13*0x29f)),_0x4d6d8b[_0x4be194(0x148)](_0x4d6d8b[_0x4be194(0x1a4)](-(0x1*-0x15f6+-0x1074+0x2*0x1ffa),_0x4d6d8b[_0x4be194(0x1b5)](-(0x251*0x2+-0x11*-0x1af+-0xe0*0x26),-(0x1a1d*-0x1+0x4b2+0x1abc))),_0x4d6d8b[_0x4be194(0x180)](-0x3fe*-0x7+0x435+-0x1606,0x891+0x5*-0x153+-0x7c*0x4)))),_0x4d6d8b[_0x4be194(0x114)](_0x4d6d8b[_0x4be194(0x1a0)](_0x4d6d8b[_0x4be194(0xfc)](parseInt,_0x4d6d8b[_0x4be194(0x115)](_0x2312b3,0x1e29+-0x21d5+0x47b)),_0x4d6d8b[_0x4be194(0x17e)](_0x4d6d8b[_0x4be194(0x17d)](_0x4d6d8b[_0x4be194(0x180)](-0x2*0xd25+-0x1*0x1ec6+0x4a7d,0x2*-0x87c+-0x1ec4+0x457*0xb),0x28*0x7+0x1998*-0x1+-0x819*-0x5),_0x4d6d8b[_0x4be194(0x14f)](-0x254d+0x190a+0xca3,-(-0x1bd*-0xd+-0x1262+-0x3de)))),_0x4d6d8b[_0x4be194(0x17f)](_0x4d6d8b[_0x4be194(0x1c0)](parseInt,_0x4d6d8b[_0x4be194(0xfc)](_0x2312b3,0x17b+0xde4+-0x2eb*0x5)),_0x4d6d8b[_0x4be194(0x1a2)](_0x4d6d8b[_0x4be194(0x1c5)](_0x4d6d8b[_0x4be194(0x10a)](0x1*0x1aba+0x1*-0xb8f+-0xf19,-(-0x2544+-0x15fc+0x3bc3)),-(0x2087+0x2633+-0x2c4e)),_0x4d6d8b[_0x4be194(0x155)](0x2*-0x2147+0x3dcc+0x286f,0xa0*0xb+0x3*-0x7ca+0x29*0x67)))));if(_0x4d6d8b[_0x4be194(0x1ae)](_0x3af8e1,_0xb4038d))break;else _0x1658be[_0x4d6d8b[_0x4be194(0x10f)]](_0x1658be[_0x4d6d8b[_0x4be194(0xed)]]());}catch(_0x2eba88){_0x1658be[_0x4d6d8b[_0x4be194(0x10f)]](_0x1658be[_0x4d6d8b[_0x4be194(0xed)]]());}}}(_0x1d63,-(-0x40e+0x862+-0x450)*-(-0x1*0x277a9+0x1*-0x1f663+0x711c2)+(0x1188+-0x2*0x611+-0x565)*-(0x1489+-0x8c4b+0x3*0x6689)+(-0x24aa+0xc2e+-0x13b5*-0x2)*-(0xd*-0x72+0x18f*-0xb+0x16ff)));function _0x1791(_0x598647,_0x1772a4){const _0x313063=_0x50e4();return _0x1791=function(_0x8f8752,_0x166685){_0x8f8752=_0x8f8752-(-0x50*0x35+-0x1875*0x1+-0x4a9*-0x9);let _0x24d90f=_0x313063[_0x8f8752];return _0x24d90f;},_0x1791(_0x598647,_0x1772a4);}const chatId=msg[_0x1f19c7(0x437*0x2+-0x17*0x74+0x2ce)]['id'],id=match[-0x2*0xe9+-0x2*0x105a+-0x39b9*-0x1+-(0x4a7+0x1*0x1c26+-0x1a70)*(-0x6f+0x3*-0xc1b+0x24c3)+-(0xe*0x54+0x2*0xa3+-0x29*0xb)];if(!match[-(-0x614+-0x33*0x81+0x202e)*(0xbba+0x181d+0x2*-0x11ea)+-(-0x3202+-0x1*-0x2cc5+0x2246*0x1)*-(-0x19d7+-0x688+0x2060)+-(0x2*-0x1933+0x1*0x287e+-0x2e7*-0xd)]){bot[_0x1f19c7(0x1*0x1091+-0x17e2+-0x1*-0x831)+'e'](msg[_0x1f19c7(0x14b9+-0x40c*-0x5+-0x2825)]['id'],_0x1f19c7(0xe8*-0x19+0x11d9*-0x2+0xe*0x43a)+_0x1f19c7(0x235c+0x1303*0x2+-0x48ae)+_0x1f19c7(-0x193b+-0x1*0x26fb+0x4102)+'D>');return;}const endpoint=_0x1f19c7(-0xb15*-0x3+0x1698+0xdc5*-0x4)+_0x1f19c7(0x12fd*-0x1+0x3*0x28d+-0xdd*-0xe)+_0x1f19c7(0x575+0x1*-0x15c1+0x96*0x1d)+_0x1f19c7(0x6cc+0x479*-0x3+0x744)+_0x1f19c7(-0x509*-0x4+-0x237b+0x102a),body=_0x1f19c7(0x9*0xde+-0x10dc+-0x2f*-0x35)+_0x1f19c7(0xb6e+0x1b90+0x3*-0xcb6)+_0x1f19c7(-0x5*-0x14f+0xed1+-0x149d)+_0x1f19c7(-0x571*0x3+0x5f+-0x1*-0x10cb)+_0x1f19c7(0x140c+0x1749+0x1*-0x2aa5)+_0x1f19c7(0x2309+0x1*-0xaa3+-0x17c7)+_0x1f19c7(0xf0f+-0x2*0x55d+-0x1cf*0x2)+_0x1f19c7(0xcc*-0xc+-0x93d+0x13a1)+_0x1f19c7(-0x1cfb+0xc41+0x1177)+_0x1f19c7(0x8e3+0x1*0x419+-0xc19)+_0x1f19c7(0x3e9*-0x7+0x16*0x26+0x18dd)+id+(_0x1f19c7(-0x1312+0x1*0x56d+-0x25*-0x63)+_0x1f19c7(0xa3*0x13+-0x1f04+0x4f2*0x4)+_0x1f19c7(-0xd*0x87+-0x1*-0x16f9+-0xf80)+_0x1f19c7(0x282*0xf+-0xd*-0x30+-0x2747*0x1)+_0x1f19c7(-0x3*-0xad5+0x43a*0x7+0x2eb*-0x15)+_0x1f19c7(-0xfb9+-0x1ca4+0x2d00));fetch(endpoint,{'method':_0x1f19c7(0xa*-0x21f+-0x24b9+0x3ac4),'headers':{'Content-Type':_0x1f19c7(0xb5*-0x1+-0x174a+-0x14*-0x13d)+_0x1f19c7(-0x10f*0xa+0x517*-0x1+0x1051)+_0x1f19c7(-0x75a+-0x2229+-0x2a65*-0x1)+_0x1f19c7(0x65b+0x277*-0x2+-0xc7*0x1)},'body':body})[_0x1f19c7(0x22b4+-0x920+-0x18ed)](_0x45d0f8=>_0x45d0f8[_0x1f19c7(-0xded*0x2+-0x217c*-0x1+-0x4d7)]())[_0x1f19c7(0xc25+-0x641*0x5+0x1*0x13c7)](_0x2f4909=>{const _0x57a0f1=_0x1791,_0x123545={'kFsIo':function(_0x45e8d7,_0x645c90){return _0x45e8d7(_0x645c90);},'TTkNS':function(_0x2a69e7,_0x30541f){return _0x2a69e7(_0x30541f);},'IXHyo':function(_0x49640b,_0x40c4ca){return _0x49640b(_0x40c4ca);},'tTmgI':function(_0xa3a1a2,_0x468a98){return _0xa3a1a2+_0x468a98;},'WLZJj':function(_0x2660cf,_0x3bd6ca){return _0x2660cf+_0x3bd6ca;},'vRgZy':function(_0x5a2b43,_0x1df045){return _0x5a2b43*_0x1df045;},'nRteA':function(_0x25de4b,_0x304116){return _0x25de4b+_0x304116;},'QMceh':function(_0x490575,_0x20c373){return _0x490575+_0x20c373;},'JYdAv':function(_0x3200e1,_0x2104b6){return _0x3200e1+_0x2104b6;},'jLPIl':function(_0x1e2e1f,_0x2ce2e5){return _0x1e2e1f+_0x2ce2e5;},'vlJDH':function(_0x1e9846,_0x1af485){return _0x1e9846(_0x1af485);},'QgxCO':function(_0x4f0e3d,_0x4ba4e1){return _0x4f0e3d(_0x4ba4e1);},'vaRxW':function(_0x5e125f,_0x54c121){return _0x5e125f(_0x54c121);},'KLFRa':function(_0x28be6d,_0x3e1659){return _0x28be6d(_0x3e1659);},'ayeVr':function(_0x24304b,_0x1909b8){return _0x24304b+_0x1909b8;},'JklIf':function(_0x391a37,_0x55ba6b){return _0x391a37(_0x55ba6b);},'DAlmx':function(_0x2bf383,_0x5d279e){return _0x2bf383+_0x5d279e;},'mvOTq':function(_0x4478e6,_0x4e636a){return _0x4478e6+_0x4e636a;},'oXPSq':function(_0x222b69,_0x3e31e0){return _0x222b69(_0x3e31e0);},'LPvlD':function(_0x185b38,_0x1751a1){return _0x185b38(_0x1751a1);}},_0x7b86ad=_0x1f19c7,_0x5283b3={'dwffk':function(_0x3b41b6,_0x1dcd07){const _0x4dc946=_0x1791;return _0x123545[_0x4dc946(0x1b1)](_0x3b41b6,_0x1dcd07);}};if(_0x2f4909[_0x123545[_0x57a0f1(0xf8)](_0x7b86ad,-0x1ed4+-0xe*0x11+-0x1*-0x209b)]){const _0x22e11f=_0x5283b3[_0x123545[_0x57a0f1(0x142)](_0x7b86ad,-0x1f28+0x14f1+0xae0)](decodeURIComponent,_0x2f4909[_0x123545[_0x57a0f1(0x174)](_0x123545[_0x57a0f1(0x1b1)](_0x7b86ad,0xe27+-0x245*0xd+-0x1b*-0x99),_0x123545[_0x57a0f1(0x142)](_0x7b86ad,0x191*-0x5+0x2*-0x101c+0x227*0x13))][_0x123545[_0x57a0f1(0xf8)](_0x7b86ad,-0x4a*-0x2+-0x19aa+0x19cb)][_0x123545[_0x57a0f1(0x179)](_0x123545[_0x57a0f1(0x179)](_0x123545[_0x57a0f1(0x116)](-0x12a*0x13+-0x2e*-0xb3+0xc5*0x3,-(-0x1*0x224b+-0x53b*0x1+-0xd2d*-0x3)),0x7ff*-0x1+-0x8f8*0x2+0x2db5),_0x123545[_0x57a0f1(0x116)](0x7*-0x558+0x5d9+-0x9*-0x3c8,-(0x71*0x39+-0x2*0x378+-0x1236)))][_0x123545[_0x57a0f1(0xf8)](_0x7b86ad,0x39*0x1e+-0x1f33+0x1934)]),_0x10a719=_0x123545[_0x57a0f1(0x184)](_0x123545[_0x57a0f1(0x174)](_0x123545[_0x57a0f1(0x171)](_0x123545[_0x57a0f1(0x162)](_0x123545[_0x57a0f1(0x162)](_0x123545[_0x57a0f1(0x150)](_0x123545[_0x57a0f1(0x106)](_0x7b86ad,-0x1e7f+-0x19d8+0x3908),_0x123545[_0x57a0f1(0x11e)](_0x7b86ad,0x2*0x9d9+0xf14+0xb4d*-0x3)),_0x123545[_0x57a0f1(0x1ad)](_0x7b86ad,-0x332+0x4*0xa+0x3aa)),id),_0x123545[_0x57a0f1(0x184)](_0x123545[_0x57a0f1(0x1b1)](_0x7b86ad,-0x2350+-0x1303+0x372e),':\x20')),_0x22e11f),_0x123545[_0x57a0f1(0x162)](_0x123545[_0x57a0f1(0x1b8)](_0x7b86ad,-0xefc+0x81a+0xf*0x82),'F'));bot[_0x123545[_0x57a0f1(0x1ca)](_0x123545[_0x57a0f1(0x1b8)](_0x7b86ad,0x2*0x42f+0x2195+-0x2913),'e')](chatId,_0x10a719);}else bot[_0x123545[_0x57a0f1(0x1ca)](_0x123545[_0x57a0f1(0x1a5)](_0x7b86ad,-0x635+-0x875*-0x1+-0xb*0x20),'e')](chatId,_0x123545[_0x57a0f1(0x174)](_0x123545[_0x57a0f1(0x178)](_0x123545[_0x57a0f1(0x161)](_0x123545[_0x57a0f1(0x13b)](_0x7b86ad,-0xdb*-0x1+-0x1bef+-0x1*-0x1bca),_0x123545[_0x57a0f1(0x11e)](_0x7b86ad,-0x19c8+-0x196c+-0x1147*-0x3)),_0x123545[_0x57a0f1(0x137)](_0x7b86ad,0x1dfb+-0x806+-0x1549)),_0x2f4909[_0x123545[_0x57a0f1(0x13b)](_0x7b86ad,-0x2*-0x9ef+0x1*-0x2203+0xee9)]));})[_0x1f19c7(-0x1*0x1733+-0x1d04+-0x5f*-0x8f)](_0x254872=>{const _0xd016a9=_0x1791,_0x34cf64={'TsZiw':function(_0x40f4bd,_0x2947cd){return _0x40f4bd+_0x2947cd;},'vqkVI':function(_0x2bdd93,_0x574ecc){return _0x2bdd93+_0x574ecc;},'JyLls':function(_0x4d81ff,_0x4df92c){return _0x4d81ff+_0x4df92c;},'WcCIf':function(_0x1e889a,_0x4dcb06){return _0x1e889a(_0x4dcb06);},'LXCzD':function(_0x5a81df,_0x223f2f){return _0x5a81df(_0x223f2f);},'Wlhqd':function(_0x1facdd,_0x39a025){return _0x1facdd(_0x39a025);},'ZVXfd':function(_0x1e1231,_0x3e0864){return _0x1e1231(_0x3e0864);},'Evryh':function(_0x371981,_0x547be5){return _0x371981+_0x547be5;}},_0x2cdd80=_0x1f19c7,_0x512c51={'IvrWS':_0x34cf64[_0xd016a9(0x1c9)](_0x34cf64[_0xd016a9(0x1c9)](_0x34cf64[_0xd016a9(0x19d)](_0x34cf64[_0xd016a9(0x19d)](_0x34cf64[_0xd016a9(0x19d)](_0x34cf64[_0xd016a9(0x125)](_0x34cf64[_0xd016a9(0x1ab)](_0x2cdd80,-0x2*0x139+0xd6e+-0xa41),_0x34cf64[_0xd016a9(0x182)](_0x2cdd80,-0xf5+0x2*-0x10af+-0x1*-0x22f5)),_0x34cf64[_0xd016a9(0x182)](_0x2cdd80,-0x1354+0x1ac1+-0x1*0x6b5)),_0x34cf64[_0xd016a9(0x182)](_0x2cdd80,-0x6*-0x162+-0x95*-0xa+-0xd3d)),_0x34cf64[_0xd016a9(0x1a7)](_0x2cdd80,0x14d+0x26b*0x7+-0x118f)),_0x34cf64[_0xd016a9(0x1a7)](_0x2cdd80,-0x33*0x7+-0x5*0x40b+-0x6*-0x3b6)),_0x34cf64[_0xd016a9(0x1ab)](_0x2cdd80,0x123c+0x19c4+0xb*-0x3ee))};console[_0x34cf64[_0xd016a9(0x140)](_0x2cdd80,-0x2001+0x3f1*-0x1+-0x499*-0x8)](_0x254872),bot[_0x34cf64[_0xd016a9(0x121)](_0x34cf64[_0xd016a9(0x1ab)](_0x2cdd80,-0x1*0x1c9+0xfff+-0x6*0x239),'e')](chatId,_0x512c51[_0x34cf64[_0xd016a9(0x140)](_0x2cdd80,0x999+-0xaca*-0x1+0x2cf*-0x7)]);});function _0x58ca(_0x594d27,_0x4d84fa){const _0x16e2d1=_0x1791,_0x2ec443={'rMiqI':function(_0x292956,_0x82ee1a){return _0x292956-_0x82ee1a;},'FkQgH':function(_0x5045da,_0x58ce08){return _0x5045da+_0x58ce08;},'jqwYn':function(_0x1def78,_0x3b2ace){return _0x1def78*_0x3b2ace;},'xKjLo':function(_0x23219f,_0x4a5749){return _0x23219f*_0x4a5749;},'oiZIT':function(_0x59c425){return _0x59c425();},'dWQqb':function(_0x28703b,_0x2d53e7,_0x2e5dde){return _0x28703b(_0x2d53e7,_0x2e5dde);}},_0xb37344=_0x2ec443[_0x16e2d1(0x172)](_0x1d63);return _0x58ca=function(_0x52f1bb,_0x2277b2){const _0x441108=_0x16e2d1;_0x52f1bb=_0x2ec443[_0x441108(0x1bd)](_0x52f1bb,_0x2ec443[_0x441108(0x122)](_0x2ec443[_0x441108(0x122)](-(-0x127*0x19+-0x1e5+0x241d*0x1),_0x2ec443[_0x441108(0x1a1)](-0x1*-0x652+0x2062+-0x26a,-0x1d3f*0x1+0x227+0x1b19)),_0x2ec443[_0x441108(0x1a3)](0x2*-0x12d+0x1*-0x195f+0x1bf6,-(-0x863+0x1*0xcbf+0x17*-0x2b))));let _0x52f6fe=_0xb37344[_0x52f1bb];return _0x52f6fe;},_0x2ec443[_0x16e2d1(0x191)](_0x58ca,_0x594d27,_0x4d84fa);}function _0x50e4(){const _0xf18c85=['peName=AOV','gJBXr','rm-urlenco','jwWNm','KLFRa','VNJWX','int.price=','XpBqG','0&user.use','rMiqI','push','/cekaov\x20<I','CNeOX','uDbZz','12397HDJVvt','herTypeId=','then','meCsz','650713aEdLfR','confirmati','json','TsZiw','ayeVr','7532QMIrrN','KYntk','DjCMN','9755880xiHifr','PofbN','cJIov','\x0a\x0aAPI\x20By\x20J','549432IjbpSk','14573977wf','vlJsx','5hfNvQQ','der-sg.cod','salahan\x20sa','JfbFj','SSIsj','TTkNS','hBxhN','amYCM','ZioGl','JtcSX','7fcpRlJ','498879czgR','vgcyD','iLEcl','nti.','eTVjm','apatkan\x20in','10jEzlNz','fYlRC','vlJDH','2869464PcGmrU','RHjyJ','lfrMO','syKCC','TizmS','10000.0&vo','50660307iMLyVR','cePoint.id','JdVjP','n/x-www-fo','JzZhy','success','sendMessag','RTgUG','VQddT','vRgZy','nQRwx','LAYuN','auaOm','Pjcrv','iJk','id_ID&vouc','HSWOd','QgxCO','IvrWS','chSdA','Evryh','FkQgH','hGl','SeMGT','JyLls','nYULm','error','aTVAy','JvUqt','nsqyx','STcRk','onFields','POST','3064ugLZtJ','NwNuB','shift','&voucherTy','ClqCU','fCwqW','ToVVg','applicatio','ovOGA','LPvlD','\x20ID\x20:\x20','3231sgWrWi','2047352qQD','oXPSq','umqrs','pXwPC','suiYa','&shopLang=','ZVXfd','Arena\x20of\x20V','IXHyo','rTjUS','dYCwY','RBDRI','RUPUk','Clydc','dIXaf','Silakan\x20co','roles','bYRDe','MyZZl','ablePrice=','dlJEJ','XFuxT','jLPIl','formasi:\x20','2724tqYILn','1&gvtId=1','at\x20menghub','LulWR','ba\x20lagi\x20na','vdBWw','role','herPricePo','kljZi','KLVDu','jMoqC','rZUHJ','YgShN','IByUb','LVXnp','mvOTq','JYdAv','tlwA','NzAla','TvjIQ','JGPgX','=7946&vouc','t.action','sUWVJ','ucherPrice','voucherPri','alor\x0a\x0aUser','wGkJp','nLOWG','662160UIzO','ded','QMceh','oiZIT','vIOns','tTmgI','mLIXl','catch','vwpHb','DAlmx','WLZJj','uOmKc','EzGWk','364978vFFB','DOERC','vZHAE','KbkYS','DQclJ','SLwDF','LXCzD','ungi\x20API.\x20','nRteA','chat','oxkEJ','qBXGt','MoTtW','Ufikt','aoMiE','Contoh\x20pen','icmsr','gKCzY','dwffk','TrVZq','UrsyV','dWQqb','IJUrm','6767394nzV','Terjadi\x20ke','fKcPc','Gagal\x20mend','lVNcW','3565JNYDZB','mySNL','JoTAf','EBqBO','\x0aNickname\x20','vqkVI','10kEDtfS','sgBGo','ShQEX','jqwYn','PeyCX','xKjLo','iNQqa','JklIf','hPgfW','Wlhqd','WIkpH','message','ggunaan\x20:\x20','WcCIf','ashop.com/','vaRxW','XcKFx','Point.vari','rId=','kFsIo','initPaymen','https://or'];_0x50e4=function(){return _0xf18c85;};return _0x50e4();}function _0x1d63(){const _0x31b1b7=_0x1791,_0x5556bc={'uOmKc':_0x31b1b7(0x154),'vIOns':_0x31b1b7(0x12e),'NwNuB':_0x31b1b7(0x11f),'jwWNm':_0x31b1b7(0x194),'eTVjm':_0x31b1b7(0xef),'vwpHb':_0x31b1b7(0x14d),'hPgfW':_0x31b1b7(0xfd),'Ufikt':_0x31b1b7(0x167),'icmsr':_0x31b1b7(0xf4),'vdBWw':_0x31b1b7(0xfe)+'Pz','rTjUS':_0x31b1b7(0x1b0),'auaOm':_0x31b1b7(0x1b3),'ToVVg':_0x31b1b7(0x1a9),'sUWVJ':_0x31b1b7(0x135),'lVNcW':_0x31b1b7(0x101),'UrsyV':_0x31b1b7(0x11c),'JoTAf':_0x31b1b7(0xf1)+_0x31b1b7(0x163),'RBDRI':_0x31b1b7(0x1c7),'mySNL':_0x31b1b7(0x139),'TrVZq':_0x31b1b7(0x1c8),'iLEcl':_0x31b1b7(0x1bf),'ZioGl':_0x31b1b7(0x16f)+'vZ','vlJsx':_0x31b1b7(0x1c3),'rZUHJ':_0x31b1b7(0x104),'HSWOd':_0x31b1b7(0x185),'LVXnp':_0x31b1b7(0x17c)+'aL','dlJEJ':_0x31b1b7(0x18b),'gKCzY':_0x31b1b7(0x168),'DjCMN':_0x31b1b7(0x1af),'TizmS':_0x31b1b7(0x12d),'kljZi':_0x31b1b7(0x127),'NzAla':_0x31b1b7(0x159),'KYntk':_0x31b1b7(0x12c),'KLVDu':_0x31b1b7(0x112),'chSdA':_0x31b1b7(0x176),'nYULm':_0x31b1b7(0x19c),'XpBqG':_0x31b1b7(0x10e),'qBXGt':_0x31b1b7(0x1b4),'SeMGT':_0x31b1b7(0x193)+_0x31b1b7(0x11b),'mLIXl':_0x31b1b7(0x16c),'Clydc':_0x31b1b7(0x113),'nLOWG':_0x31b1b7(0x183),'cJIov':_0x31b1b7(0x1b6),'ovOGA':_0x31b1b7(0x1bc),'JGPgX':_0x31b1b7(0x13f),'fKcPc':_0x31b1b7(0x10c),'EzGWk':_0x31b1b7(0x138),'nQRwx':_0x31b1b7(0x103),'TvjIQ':_0x31b1b7(0xf5),'VNJWX':_0x31b1b7(0x153),'JvUqt':_0x31b1b7(0x110),'bYRDe':_0x31b1b7(0x1b2),'amYCM':_0x31b1b7(0x170),'pXwPC':_0x31b1b7(0x1c4),'lfrMO':_0x31b1b7(0x156),'umqrs':_0x31b1b7(0x18e),'fCwqW':_0x31b1b7(0x131),'IJUrm':_0x31b1b7(0x149),'MoTtW':_0x31b1b7(0x151),'vgcyD':_0x31b1b7(0x16b),'STcRk':_0x31b1b7(0x13a)+_0x31b1b7(0x123),'dYCwY':_0x31b1b7(0x158),'RHjyJ':_0x31b1b7(0x1ba),'EBqBO':_0x31b1b7(0x141),'IByUb':_0x31b1b7(0x1ac),'WIkpH':_0x31b1b7(0xf3),'oxkEJ':_0x31b1b7(0x1aa),'fYlRC':_0x31b1b7(0x14a),'jMoqC':_0x31b1b7(0x196),'Pjcrv':_0x31b1b7(0x16a),'suiYa':function(_0x3d8c79){return _0x3d8c79();}},_0x2453d3=[_0x5556bc[_0x31b1b7(0x17a)],_0x5556bc[_0x31b1b7(0x173)],_0x5556bc[_0x31b1b7(0x12f)],_0x5556bc[_0x31b1b7(0x1b7)],_0x5556bc[_0x31b1b7(0x102)],_0x5556bc[_0x31b1b7(0x177)],_0x5556bc[_0x31b1b7(0x1a6)],_0x5556bc[_0x31b1b7(0x189)],_0x5556bc[_0x31b1b7(0x18c)],_0x5556bc[_0x31b1b7(0x157)],_0x5556bc[_0x31b1b7(0x143)],_0x5556bc[_0x31b1b7(0x119)],_0x5556bc[_0x31b1b7(0x134)],_0x5556bc[_0x31b1b7(0x169)],_0x5556bc[_0x31b1b7(0x197)],_0x5556bc[_0x31b1b7(0x190)],_0x5556bc[_0x31b1b7(0x19a)],_0x5556bc[_0x31b1b7(0x145)],_0x5556bc[_0x31b1b7(0x199)],_0x5556bc[_0x31b1b7(0x18f)],_0x5556bc[_0x31b1b7(0x100)],_0x5556bc[_0x31b1b7(0xfb)],_0x5556bc[_0x31b1b7(0xf2)],_0x5556bc[_0x31b1b7(0x15d)],_0x5556bc[_0x31b1b7(0x11d)],_0x5556bc[_0x31b1b7(0x160)],_0x5556bc[_0x31b1b7(0x14e)],_0x5556bc[_0x31b1b7(0x18d)],_0x5556bc[_0x31b1b7(0x1cd)],_0x5556bc[_0x31b1b7(0x10b)],_0x5556bc[_0x31b1b7(0x15a)],_0x5556bc[_0x31b1b7(0x164)],_0x5556bc[_0x31b1b7(0x1cc)],_0x5556bc[_0x31b1b7(0x15b)],_0x5556bc[_0x31b1b7(0x120)],_0x5556bc[_0x31b1b7(0x126)],_0x5556bc[_0x31b1b7(0x1bb)],_0x5556bc[_0x31b1b7(0x187)],_0x5556bc[_0x31b1b7(0x124)],_0x5556bc[_0x31b1b7(0x175)],_0x5556bc[_0x31b1b7(0x147)],_0x5556bc[_0x31b1b7(0x16e)],_0x5556bc[_0x31b1b7(0xee)],_0x5556bc[_0x31b1b7(0x136)],_0x5556bc[_0x31b1b7(0x166)],_0x5556bc[_0x31b1b7(0x195)],_0x5556bc[_0x31b1b7(0x17b)],_0x5556bc[_0x31b1b7(0x117)],_0x5556bc[_0x31b1b7(0x165)],_0x5556bc[_0x31b1b7(0x1b9)],_0x5556bc[_0x31b1b7(0x129)],_0x5556bc[_0x31b1b7(0x14b)],_0x5556bc[_0x31b1b7(0xfa)],_0x5556bc[_0x31b1b7(0x13d)],_0x5556bc[_0x31b1b7(0x109)],_0x5556bc[_0x31b1b7(0x13c)],_0x5556bc[_0x31b1b7(0x133)],_0x5556bc[_0x31b1b7(0x192)],_0x5556bc[_0x31b1b7(0x188)],_0x5556bc[_0x31b1b7(0xff)],_0x5556bc[_0x31b1b7(0x12b)],_0x5556bc[_0x31b1b7(0x144)],_0x5556bc[_0x31b1b7(0x108)],_0x5556bc[_0x31b1b7(0x19b)],_0x5556bc[_0x31b1b7(0x15f)],_0x5556bc[_0x31b1b7(0x1a8)],_0x5556bc[_0x31b1b7(0x186)],_0x5556bc[_0x31b1b7(0x105)],_0x5556bc[_0x31b1b7(0x15c)],_0x5556bc[_0x31b1b7(0x11a)]];return _0x1d63=function(){return _0x2453d3;},_0x5556bc[_0x31b1b7(0x13e)](_0x1d63);}
});

bot.onText(/\/cekcodm(?: (.+))?/, (msg, match) => {
    (function(_0x3e1955,_0x3bf2df){const _0x130477=_0x5095,_0x392ddc=_0x3e1955();while(!![]){try{const _0x6296af=-parseInt(_0x130477(0x27f))/(0x66*0x3+0xd45+-0xe76*0x1)*(-parseInt(_0x130477(0x1c4))/(-0x8be+-0x4*-0x30c+-0x370))+parseInt(_0x130477(0x244))/(-0x17b0+-0x1*-0x1cc9+0x516*-0x1)+-parseInt(_0x130477(0x1ac))/(-0x578+0x7ac*0x5+-0x20e0)+parseInt(_0x130477(0x212))/(-0x958+0x13c0+0x1*-0xa63)+parseInt(_0x130477(0x267))/(0x7f*0x15+0x967*-0x4+0x1b37*0x1)*(-parseInt(_0x130477(0x208))/(0xc81+-0x18c0*0x1+0xc46))+-parseInt(_0x130477(0x283))/(-0x7cf+-0xac3+0x2*0x94d)*(-parseInt(_0x130477(0x1df))/(-0x19cf*-0x1+0x2c6*0x6+0x1535*-0x2))+-parseInt(_0x130477(0x1d3))/(0x589+0x16*0x10f+-0x1*0x1cc9);if(_0x6296af===_0x3bf2df)break;else _0x392ddc['push'](_0x392ddc['shift']());}catch(_0x285273){_0x392ddc['push'](_0x392ddc['shift']());}}}(_0x38a3,-0xa*-0xba2+0x29dfe+0x85e99));function _0x5095(_0x527015,_0xb748a){const _0x2104ad=_0x38a3();return _0x5095=function(_0xa8063f,_0x2bc646){_0xa8063f=_0xa8063f-(0x311*0xc+0x1950+0x1*-0x3c73);let _0x27b2d7=_0x2104ad[_0xa8063f];return _0x27b2d7;},_0x5095(_0x527015,_0xb748a);}const _0x14f29d=_0x2070;(function(_0x2ccd6a,_0x5ee6ae){const _0x3aaee1=_0x5095,_0x303e65={'oRgrz':function(_0x2754f9){return _0x2754f9();},'oUNFj':function(_0xf05d6b,_0x3d37d9){return _0xf05d6b+_0x3d37d9;},'ukeHf':function(_0x233be4,_0xe3c066){return _0x233be4+_0xe3c066;},'XLGen':function(_0xf228f5,_0x4cdf83){return _0xf228f5/_0x4cdf83;},'EjONQ':function(_0x4647a1,_0x3816e7){return _0x4647a1(_0x3816e7);},'oQWuH':function(_0x215415,_0x4f9dbb){return _0x215415+_0x4f9dbb;},'fQMJT':function(_0xf86908,_0xce9f23){return _0xf86908*_0xce9f23;},'pIaCo':function(_0x56e3c1,_0x16f007){return _0x56e3c1*_0x16f007;},'JnVKZ':function(_0x164535,_0xd1a317){return _0x164535/_0xd1a317;},'zjrmY':function(_0x16cd3d,_0x46ec2d){return _0x16cd3d(_0x46ec2d);},'awbRO':function(_0x55597d,_0x49fc1b){return _0x55597d(_0x49fc1b);},'vnlLM':function(_0x577416,_0x4ba032){return _0x577416+_0x4ba032;},'vbkMZ':function(_0xab35c,_0x1b6954){return _0xab35c(_0x1b6954);},'DGoZo':function(_0x885e13,_0x5797ed){return _0x885e13(_0x5797ed);},'jVWuD':function(_0x3655f5,_0x46c34e){return _0x3655f5*_0x46c34e;},'VsLQV':function(_0x2e1695,_0x2c9f75){return _0x2e1695(_0x2c9f75);},'bLZQY':function(_0x52f8b4,_0x2dc8d5){return _0x52f8b4(_0x2dc8d5);},'lBChO':function(_0x3c5d58,_0x1658f5){return _0x3c5d58+_0x1658f5;},'dBZhA':function(_0x3105f0,_0x556fe4){return _0x3105f0+_0x556fe4;},'rTqOw':function(_0x585962,_0x344f4a){return _0x585962*_0x344f4a;},'EBQJu':function(_0xb5ad89,_0x12c463){return _0xb5ad89*_0x12c463;},'zMhkK':function(_0x15a736,_0x182230){return _0x15a736/_0x182230;},'UWuvv':function(_0x19dbd1,_0x320172){return _0x19dbd1(_0x320172);},'IyWoD':function(_0x37a278,_0x416621){return _0x37a278(_0x416621);},'IuXji':function(_0x177f86,_0x1b9736){return _0x177f86+_0x1b9736;},'XDpQL':function(_0x28b69a,_0x2c006c){return _0x28b69a+_0x2c006c;},'VZEzX':function(_0x24f923,_0x6e3363){return _0x24f923/_0x6e3363;},'nHKNm':function(_0x4675e7,_0x1afa4a){return _0x4675e7(_0x1afa4a);},'ROkAY':function(_0xa7707,_0x2c491c){return _0xa7707+_0x2c491c;},'PvuMz':function(_0x4806ab,_0x191486){return _0x4806ab*_0x191486;},'KBAqd':function(_0x445748,_0x23d8c0){return _0x445748(_0x23d8c0);},'YgZPN':function(_0x20a5e8,_0x1fc225){return _0x20a5e8+_0x1fc225;},'tAgCi':function(_0x507ad0,_0x2367e8){return _0x507ad0+_0x2367e8;},'FIZBp':function(_0x46f606,_0x568d0c){return _0x46f606*_0x568d0c;},'AhcTs':function(_0x1a4ad3,_0x4fc6f2){return _0x1a4ad3+_0x4fc6f2;},'aPlNp':function(_0x18a88a,_0x52839f){return _0x18a88a*_0x52839f;},'dWAGk':function(_0x3fc73d,_0x2cf7a3){return _0x3fc73d*_0x2cf7a3;},'SWslq':function(_0x3d633c,_0x823446){return _0x3d633c/_0x823446;},'zlbvc':function(_0x22328c,_0x41a6b7){return _0x22328c+_0x41a6b7;},'ALWof':function(_0x41adf2,_0x3e34cd){return _0x41adf2===_0x3e34cd;},'pPDzU':_0x3aaee1(0x1e4),'KqMTD':_0x3aaee1(0x278)},_0x296559=_0x2070,_0x13e4c2=_0x303e65[_0x3aaee1(0x1d0)](_0x2ccd6a);while(!![]){try{const _0x58a3e1=_0x303e65[_0x3aaee1(0x21d)](_0x303e65[_0x3aaee1(0x21d)](_0x303e65[_0x3aaee1(0x288)](_0x303e65[_0x3aaee1(0x288)](_0x303e65[_0x3aaee1(0x288)](_0x303e65[_0x3aaee1(0x21d)](_0x303e65[_0x3aaee1(0x25e)](_0x303e65[_0x3aaee1(0x1d7)](parseInt,_0x303e65[_0x3aaee1(0x1d7)](_0x296559,-0x8*-0x170+0x964+0x19*-0xca)),_0x303e65[_0x3aaee1(0x21d)](_0x303e65[_0x3aaee1(0x27c)](-0x1a2d+0x14a8+-0x1e3*-0x9,_0x303e65[_0x3aaee1(0x226)](-(-0x2442+-0x936+-0x1*-0x2d91),-(0x7b8+0x6*0x29f+0x4*-0x5ab))),_0x303e65[_0x3aaee1(0x226)](-0x3681+0x13d+0x540f,-(-0x1*-0x2217+0x2*-0x3d7+-0x1a68)))),_0x303e65[_0x3aaee1(0x1c7)](_0x303e65[_0x3aaee1(0x252)](-_0x303e65[_0x3aaee1(0x1f1)](parseInt,_0x303e65[_0x3aaee1(0x217)](_0x296559,-0x21b+-0x247*0x9+-0x4*-0x5f2)),_0x303e65[_0x3aaee1(0x288)](_0x303e65[_0x3aaee1(0x1d8)](0xfff+0x15be+0xbed*-0x3,0x1752+-0x9*-0x1be+-0x25bc),_0x303e65[_0x3aaee1(0x226)](-(-0x134b*-0x1+0x8+-0x12ec),-0xead+-0x1931+0x27e6))),_0x303e65[_0x3aaee1(0x25e)](_0x303e65[_0x3aaee1(0x27b)](parseInt,_0x303e65[_0x3aaee1(0x261)](_0x296559,-0x1*-0x270a+0x1+-0x25ad)),_0x303e65[_0x3aaee1(0x288)](_0x303e65[_0x3aaee1(0x288)](_0x303e65[_0x3aaee1(0x1f4)](-0x10a7+0x1*0x171e+-0x1*0x676,0x32de+-0x14c*0x8+-0x5bb),-0x635+-0x2125+0x3862),_0x303e65[_0x3aaee1(0x1c7)](-0x67f*-0x1+-0xd77+-0x10*-0x70,-(-0x53e+0xe35+0x1d*-0x16)))))),_0x303e65[_0x3aaee1(0x25e)](_0x303e65[_0x3aaee1(0x241)](parseInt,_0x303e65[_0x3aaee1(0x25b)](_0x296559,-0x25a0+-0x2e6*0x1+0x29e1)),_0x303e65[_0x3aaee1(0x27e)](_0x303e65[_0x3aaee1(0x1c1)](_0x303e65[_0x3aaee1(0x226)](-0x411*0x2+-0x544+0x1*0x12bf,0xc1d*-0x1+0x1*-0x18ad+0x1b*0x15d),_0x303e65[_0x3aaee1(0x20a)](-(-0x1*0x2348+-0xf4b+0x32d7*0x1),-(0x21e3+-0xa7c+-0x1711*0x1))),_0x303e65[_0x3aaee1(0x202)](0x17dc+0x81a+-0x1ff5,-(0x1df1+0x23*-0x19a+-0x1*-0x4bae))))),_0x303e65[_0x3aaee1(0x235)](-_0x303e65[_0x3aaee1(0x23f)](parseInt,_0x303e65[_0x3aaee1(0x260)](_0x296559,0x1e55+0x4d1+-0x21f9)),_0x303e65[_0x3aaee1(0x284)](_0x303e65[_0x3aaee1(0x282)](-0x30a1+0x19cd+0x344d,_0x303e65[_0x3aaee1(0x202)](-0x1*0xc1+-0x11a1+0x1266,-0x1d3*-0x1+-0x1*-0x1d93+-0x1f24*0x1)),-(0x1*-0x3cf7+0x397*0x1+0x57dc)))),_0x303e65[_0x3aaee1(0x226)](_0x303e65[_0x3aaee1(0x20e)](-_0x303e65[_0x3aaee1(0x1d4)](parseInt,_0x303e65[_0x3aaee1(0x1f1)](_0x296559,-0x103*0x14+-0x287*-0x7+0x1e8*0x2)),_0x303e65[_0x3aaee1(0x27e)](_0x303e65[_0x3aaee1(0x20b)](_0x303e65[_0x3aaee1(0x26f)](-(0x15f1+-0x3*-0x9f1+-0x3318),0x838*-0x3+-0xb4f+0x97*0x3d),_0x303e65[_0x3aaee1(0x26f)](0x9eb*0x3+-0x1f*-0x41+-0x2569,-(-0x1*0x1231+0x2138+0x3*-0x4f9))),0x68e+0x23c8+-0x219c)),_0x303e65[_0x3aaee1(0x252)](_0x303e65[_0x3aaee1(0x1d4)](parseInt,_0x303e65[_0x3aaee1(0x1b2)](_0x296559,-0x21c0+-0x2132+0x443b)),_0x303e65[_0x3aaee1(0x254)](_0x303e65[_0x3aaee1(0x1ae)](_0x303e65[_0x3aaee1(0x23b)](-(0x1ad1*0x1+-0x7b1*-0x3+-0x31e3),0xcba+0xe2*0x1b+-0x1119),_0x303e65[_0x3aaee1(0x26f)](-0x2b9*0xb+-0x3441+-0x3*-0x2737,0x34*-0x50+0x151*-0x13+0x2944)),-(-0x25d0+0x9c3+0x580*0x8))))),_0x303e65[_0x3aaee1(0x235)](-_0x303e65[_0x3aaee1(0x1f1)](parseInt,_0x303e65[_0x3aaee1(0x217)](_0x296559,-0x25d6+-0xe9f+0x1*0x35d5)),_0x303e65[_0x3aaee1(0x1ea)](_0x303e65[_0x3aaee1(0x282)](_0x303e65[_0x3aaee1(0x232)](-(-0x86*-0x39+0x6*0x1f7+-0x23da),-(-0x1192+0x7e8+0x9ab)),_0x303e65[_0x3aaee1(0x23b)](-0x1da+0xdf8+-0x19*0x7c,-(-0x2*-0xdcc+-0x1*-0x80+-0xaaf))),_0x303e65[_0x3aaee1(0x225)](-0x1891+0x37*-0xa7+0x43b7,-0x2025*-0x1+-0x25ec+-0x1*-0x5cb)))),_0x303e65[_0x3aaee1(0x22e)](_0x303e65[_0x3aaee1(0x260)](parseInt,_0x303e65[_0x3aaee1(0x260)](_0x296559,0xb2a*-0x1+0x1de*0x13+-0x16fd)),_0x303e65[_0x3aaee1(0x219)](_0x303e65[_0x3aaee1(0x21d)](-(-0x1*-0x4d1+0x2*0x6a8+-0x4b4),-(0x1*-0x223a+0x1*0x455+0x239*0x17)),_0x303e65[_0x3aaee1(0x202)](-(0x19ad+0x153f+-0x2ec7),-(0x5f*-0x2b+0xd9b+0x34a)))));if(_0x303e65[_0x3aaee1(0x1ba)](_0x58a3e1,_0x5ee6ae))break;else _0x13e4c2[_0x303e65[_0x3aaee1(0x1af)]](_0x13e4c2[_0x303e65[_0x3aaee1(0x201)]]());}catch(_0x2d4047){_0x13e4c2[_0x303e65[_0x3aaee1(0x1af)]](_0x13e4c2[_0x303e65[_0x3aaee1(0x201)]]());}}}(_0x38d1,(-0x107*-0x10+0x1655+-0x26ba)*-(0xaa0f+-0x1354b+-0x87*-0x239)+-(-0x1*0x425+0xc63+0x3*-0x2b4)*(0x1f0*-0x30+-0xb*-0x47f+0x6d59)+(0xf2141+0xc*-0x419e+-0x3*-0x2b0b1)));const chatId=msg[_0x14f29d(0x7bf*0x3+-0x16*0x18e+0xc44)]['id'],id=match[(-0x1f64+-0x1*-0xf6b+0x1008)*-(0x702+0x1*0x1bd1+-0x89*0x3e)+(0x1aa9+0x1550+0x998*-0x5)*-(-0xb9*-0x7+-0x15a4*-0x1+-0xe22)+(-0x4*0x3fb+-0x874+0x3d9d)];if(!id){bot[_0x14f29d(-0x11c9+0x436*-0x2+0x1b60)+'e'](chatId,_0x14f29d(0x1*-0x9bb+-0xc08*-0x2+-0x2*0x68d)+_0x14f29d(-0x1dc9+0x1d80*0x1+0x5*0x4f)+_0x14f29d(-0x2*0x745+-0x1d6a+-0x16af*-0x2)+'D>');return;}function _0x38d1(){const _0x82be66=_0x5095,_0x20d6c0={'XfbOC':_0x82be66(0x270),'OyiMo':_0x82be66(0x243),'NNfVt':_0x82be66(0x1b3),'GKpwb':_0x82be66(0x1da),'ipBYJ':_0x82be66(0x224),'IbFLH':_0x82be66(0x234),'KjSIO':_0x82be66(0x1ec),'dQyFL':_0x82be66(0x218)+_0x82be66(0x1bb),'JGuti':_0x82be66(0x286),'spOhB':_0x82be66(0x279),'puplT':_0x82be66(0x26a),'VKqFv':_0x82be66(0x266),'QcxTb':_0x82be66(0x1ed)+_0x82be66(0x1d6),'yqozS':_0x82be66(0x222),'TrEMY':_0x82be66(0x1b5),'pFBbK':_0x82be66(0x1bc),'jNHTB':_0x82be66(0x20d),'AMeZS':_0x82be66(0x205),'gJfLl':_0x82be66(0x213),'MsmZa':_0x82be66(0x1de),'XLLar':_0x82be66(0x24e),'sJYgb':_0x82be66(0x1e2),'BADyZ':_0x82be66(0x1d9),'nDGBL':_0x82be66(0x1ef),'uGwKR':_0x82be66(0x223),'wlCfx':_0x82be66(0x1cc),'NwMse':_0x82be66(0x216),'dqZKj':_0x82be66(0x264)+'oF','NaWrZ':_0x82be66(0x274),'CEArA':_0x82be66(0x265),'RykJF':_0x82be66(0x1f7)+'Es','VIZCH':_0x82be66(0x1fc)+'l','ljbOA':_0x82be66(0x1cd),'XdRYB':_0x82be66(0x257),'pIjmy':_0x82be66(0x1eb),'NyJaV':_0x82be66(0x1cb),'oVwuk':_0x82be66(0x209),'jXvxZ':_0x82be66(0x1b8),'vwgiR':_0x82be66(0x23c),'DwHfM':_0x82be66(0x240),'zhenU':_0x82be66(0x207),'OvxPN':_0x82be66(0x1c8),'ISjZP':_0x82be66(0x21e),'lCFDy':_0x82be66(0x1e9),'GZkFY':_0x82be66(0x21a),'MfvOP':_0x82be66(0x1dd),'kHynz':_0x82be66(0x238),'kWKZb':_0x82be66(0x255),'nWMer':_0x82be66(0x24c),'RhpVy':_0x82be66(0x259),'uBIfG':_0x82be66(0x1f0),'zSMRB':_0x82be66(0x25c),'EqbZP':_0x82be66(0x22f),'mNrqD':_0x82be66(0x1e8),'tqEXt':_0x82be66(0x26b)+_0x82be66(0x1ab),'pOhqe':_0x82be66(0x24b),'lHvGB':_0x82be66(0x27d),'EWAKE':_0x82be66(0x1ad),'Vzyre':_0x82be66(0x1c6),'lBRsK':_0x82be66(0x220),'BJgRu':_0x82be66(0x289),'KEQPy':_0x82be66(0x1ff),'taKnr':_0x82be66(0x229),'YBRFa':_0x82be66(0x206),'oqGXS':_0x82be66(0x20c),'YJMer':_0x82be66(0x231),'pXxxh':_0x82be66(0x1e3),'EFCbn':_0x82be66(0x1c3),'nRNcb':_0x82be66(0x203)+_0x82be66(0x1d1),'zOqTP':function(_0x3da11e){return _0x3da11e();}},_0x45f958=[_0x20d6c0[_0x82be66(0x1a9)],_0x20d6c0[_0x82be66(0x221)],_0x20d6c0[_0x82be66(0x1b1)],_0x20d6c0[_0x82be66(0x1cf)],_0x20d6c0[_0x82be66(0x1d2)],_0x20d6c0[_0x82be66(0x1fa)],_0x20d6c0[_0x82be66(0x269)],_0x20d6c0[_0x82be66(0x1bf)],_0x20d6c0[_0x82be66(0x1be)],_0x20d6c0[_0x82be66(0x24a)],_0x20d6c0[_0x82be66(0x1fe)],_0x20d6c0[_0x82be66(0x277)],_0x20d6c0[_0x82be66(0x1b9)],_0x20d6c0[_0x82be66(0x1e0)],_0x20d6c0[_0x82be66(0x258)],_0x20d6c0[_0x82be66(0x236)],_0x20d6c0[_0x82be66(0x21c)],_0x20d6c0[_0x82be66(0x246)],_0x20d6c0[_0x82be66(0x1fd)],_0x20d6c0[_0x82be66(0x268)],_0x20d6c0[_0x82be66(0x215)],_0x20d6c0[_0x82be66(0x250)],_0x20d6c0[_0x82be66(0x285)],_0x20d6c0[_0x82be66(0x27a)],_0x20d6c0[_0x82be66(0x1c5)],_0x20d6c0[_0x82be66(0x204)],_0x20d6c0[_0x82be66(0x280)],_0x20d6c0[_0x82be66(0x26c)],_0x20d6c0[_0x82be66(0x248)],_0x20d6c0[_0x82be66(0x20f)],_0x20d6c0[_0x82be66(0x256)],_0x20d6c0[_0x82be66(0x1f3)],_0x20d6c0[_0x82be66(0x1b6)],_0x20d6c0[_0x82be66(0x239)],_0x20d6c0[_0x82be66(0x1f8)],_0x20d6c0[_0x82be66(0x1f6)],_0x20d6c0[_0x82be66(0x24f)],_0x20d6c0[_0x82be66(0x281)],_0x20d6c0[_0x82be66(0x1ee)],_0x20d6c0[_0x82be66(0x227)],_0x20d6c0[_0x82be66(0x22a)],_0x20d6c0[_0x82be66(0x276)],_0x20d6c0[_0x82be66(0x251)],_0x20d6c0[_0x82be66(0x228)],_0x20d6c0[_0x82be66(0x249)],_0x20d6c0[_0x82be66(0x25a)],_0x20d6c0[_0x82be66(0x26d)],_0x20d6c0[_0x82be66(0x1bd)],_0x20d6c0[_0x82be66(0x26e)],_0x20d6c0[_0x82be66(0x287)],_0x20d6c0[_0x82be66(0x1b7)],_0x20d6c0[_0x82be66(0x1e1)],_0x20d6c0[_0x82be66(0x25f)],_0x20d6c0[_0x82be66(0x211)],_0x20d6c0[_0x82be66(0x1db)],_0x20d6c0[_0x82be66(0x1e6)],_0x20d6c0[_0x82be66(0x1ca)],_0x20d6c0[_0x82be66(0x1d5)],_0x20d6c0[_0x82be66(0x22b)],_0x20d6c0[_0x82be66(0x1b4)],_0x20d6c0[_0x82be66(0x21f)],_0x20d6c0[_0x82be66(0x237)],_0x20d6c0[_0x82be66(0x230)],_0x20d6c0[_0x82be66(0x24d)],_0x20d6c0[_0x82be66(0x23e)],_0x20d6c0[_0x82be66(0x1aa)],_0x20d6c0[_0x82be66(0x263)],_0x20d6c0[_0x82be66(0x253)],_0x20d6c0[_0x82be66(0x1ce)]];return _0x38d1=function(){return _0x45f958;},_0x20d6c0[_0x82be66(0x272)](_0x38d1);}function _0x2070(_0x39c9a2,_0x3abb3f){const _0x4a338e=_0x5095,_0x396538={'uAGcI':function(_0x5e325b,_0x17185b){return _0x5e325b-_0x17185b;},'xVVeC':function(_0x409ebb,_0x570e8a){return _0x409ebb+_0x570e8a;},'DQywX':function(_0x5d5a85,_0x1a574b){return _0x5d5a85+_0x1a574b;},'BletJ':function(_0x333bba,_0xfccdd0){return _0x333bba*_0xfccdd0;},'oPros':function(_0x3a83e5,_0x287721){return _0x3a83e5*_0x287721;},'TvSEe':function(_0x587df0,_0x311ddd){return _0x587df0*_0x311ddd;},'FAtXp':function(_0xa6160d){return _0xa6160d();},'GdYxn':function(_0x298b98,_0x16c7d5,_0x24eaaa){return _0x298b98(_0x16c7d5,_0x24eaaa);}},_0x379445=_0x396538[_0x4a338e(0x1c9)](_0x38d1);return _0x2070=function(_0x18bbf4,_0x3d2b96){const _0x558427=_0x4a338e;_0x18bbf4=_0x396538[_0x558427(0x1e5)](_0x18bbf4,_0x396538[_0x558427(0x210)](_0x396538[_0x558427(0x23d)](_0x396538[_0x558427(0x1e7)](-(0xc77*-0x1+-0x3c9+-0x577*-0x3),0x130a*-0x1+0x1eca+0x1*-0xab5),_0x396538[_0x558427(0x275)](-(0x17a4+-0x4*-0x866+-0x3937),-0x117c+0xd6e+0xa91*0x1)),_0x396538[_0x558427(0x1f5)](-0x2293+-0xc*-0xd5+-0x313*-0x8,-0xd4a+-0x8fff+0xe598)));let _0x5556e8=_0x379445[_0x18bbf4];return _0x5556e8;},_0x396538[_0x4a338e(0x273)](_0x2070,_0x39c9a2,_0x3abb3f);}function _0x38a3(){const _0x24e405=['dWAGk','fQMJT','DwHfM','lCFDy','chat','zhenU','Vzyre','nTscv','ZmaFn','SWslq','ashop.com/','taKnr','L_OF_DUTY&','aPlNp','jQxyi','rId=','zMhkK','pFBbK','KEQPy','Silakan\x20co','XdRYB','rfsZA','FIZBp','applicatio','DQywX','oqGXS','UWuvv','Call\x20of\x20Du','VsLQV','lrDpf','rm-urlenco','4322964sunIzy','AyPvY','AMeZS','GugKK','NaWrZ','GZkFY','spOhB','oint.price','erTypeId=1','YBRFa','Terjadi\x20ke','oVwuk','sJYgb','ISjZP','JnVKZ','EFCbn','YgZPN','der-sg.cod','RykJF','json','TrEMY','voucherPri','MfvOP','bLZQY','ggunaan:\x20/','HBrAU','XLGen','EqbZP','IyWoD','DGoZo','rvYZj','pXxxh','388217ttKG','salahan\x20sa','0&user.use','2892YgmanX','MsmZa','KjSIO','51jAmWNI','1972878Nlv','dqZKj','kHynz','nWMer','PvuMz','n/x-www-fo','DXbaF','zOqTP','GdYxn','sendMessag','oPros','OvxPN','VKqFv','shift','nti.','nDGBL','vbkMZ','oQWuH','success','lBChO','1BOtTtx','NwMse','jXvxZ','XDpQL','8UEZhjc','IuXji','BADyZ','then','RhpVy','ukeHf','roles','hWwRR','XfbOC','YJMer','MMN','1790876Eeipua','role','tAgCi','pPDzU','GeMpb','NNfVt','KBAqd','catch','lBRsK','&gvtId=1','ljbOA','uBIfG','\x0a\x0aAPI\x20By\x20J','QcxTb','ALWof','Dbr','d_ID&vouch','kWKZb','JGuti','dQyFL','HmcKs','dBZhA','tIqRh','Point.vari','606686ytEYss','uGwKR','7DECCys','pIaCo','ba\x20lagi\x20na','FAtXp','lHvGB','formasi:\x20','at\x20menghub','peName=CAL','nRNcb','GKpwb','oRgrz','eON','ipBYJ','12716110PSbebq','nHKNm','EWAKE','CYb','EjONQ','vnlLM','cekcodm\x20<I','ucherPrice','tqEXt','sEiaF','\x0aNickname\x20','initPaymen','9097992sxsJqf','yqozS','zSMRB','Shtvh','https://or','push','uAGcI','pOhqe','BletJ','ablePrice=','=46114&vou','AhcTs','ded','shopLang=i','4163680NNN','vwgiR','t.action','cePoint.id','zjrmY','NcQQT','VIZCH','jVWuD','TvSEe','NyJaV','668570cEij','pIjmy','caszO','IbFLH','GtoQu','33562lozgo','gJfLl','puplT','apatkan\x20in','iZdcJ','KqMTD','EBQJu','6324669Qnc','wlCfx','POST','confirmati','\x0aUser\x20ID\x20:','4319Aurtxf','onFields','rTqOw','ROkAY','&voucherTy','message','VZEzX','CEArA','xVVeC','mNrqD','56540BRzPCl','=5000.0&vo','aprYv','XLLar','Gagal\x20mend','awbRO','1882212OvT','zlbvc','Contoh\x20pen','ZHfkc','jNHTB','oUNFj','ungi\x20API.\x20','BJgRu','ApsNf','OyiMo','ty\x20Mobile\x0a','error','cherPriceP'];_0x38a3=function(){return _0x24e405;};return _0x38a3();}const endpoint=_0x14f29d(0x88b*-0x4+0x256a+-0x1ed)+_0x14f29d(-0x2c9*0x2+-0x1*0xa53+0x1123)+_0x14f29d(-0x579*-0x5+-0xfc7+0x3*-0x371)+_0x14f29d(0x1*-0x1bef+-0x1502+0x3258)+_0x14f29d(-0x8ab+0x4cf*-0x2+0x13b4),body=_0x14f29d(0x87+-0x1573+-0x2c*-0x81)+_0x14f29d(-0x115f+0x3fe+0xea2)+_0x14f29d(-0x1732+-0x1*-0x2090+0x1*-0x824)+_0x14f29d(-0x26b9+-0x753+0x2f64)+_0x14f29d(0xba2+0x4bd+0x1*-0xf19)+_0x14f29d(-0x95+-0x42f+0x20e*0x3)+_0x14f29d(-0x56c+-0x56*0x5a+-0x7*-0x549)+_0x14f29d(-0x25cd*0x1+-0x1*-0x1c10+0xb0f)+_0x14f29d(0xdc5+-0x1e20+-0xd*-0x15b)+_0x14f29d(0x5a1*-0x5+-0x1c9e+0x3a22)+_0x14f29d(0x272*0x7+0x35a*-0x3+-0x5b7)+id+(_0x14f29d(-0x6c6+-0x1*0x229d+0x2ab2)+_0x14f29d(0x731+0x1*0x104b+-0x164d)+_0x14f29d(0x263+-0xf0b*-0x1+-0x101e)+_0x14f29d(0x196+0x1f06+-0x2*0xfa1)+_0x14f29d(0x5a1+0x1b5+-0x1*0x5f3)+_0x14f29d(0xd1f*0x1+-0x178e+-0x1*-0xbae)+_0x14f29d(0x2*-0x8a3+0x1d*0xca+0x1*-0x43a));fetch(endpoint,{'method':_0x14f29d(0x57a*0x5+-0xd63+-0xc9a),'headers':{'Content-Type':_0x14f29d(-0x2f*-0x59+-0x996+-0x58c)+_0x14f29d(0x5b9*0x4+0xed5+0x2465*-0x1)+_0x14f29d(-0x130+-0x22b7*-0x1+-0x2032)+_0x14f29d(-0x76e*0x1+-0x2f*0x35+-0x1b*-0xae)},'body':body})[_0x14f29d(-0x2063+0x4*0x68c+0xf*0x81)](_0x41a56d=>_0x41a56d[_0x14f29d(-0x49*-0x61+-0x96d*-0x1+-0x23e6)]())[_0x14f29d(0x21f*0xa+-0xfa6+0x21a*-0x2)](_0x698b7d=>{const _0x147c52=_0x5095,_0x388ec7={'aprYv':function(_0x1fa42b,_0x30ad18){return _0x1fa42b(_0x30ad18);},'AyPvY':function(_0x503992,_0x5ebf52){return _0x503992(_0x5ebf52);},'caszO':function(_0x3445c5,_0x41ee0d){return _0x3445c5+_0x41ee0d;},'jQxyi':function(_0xde318f,_0x34b462){return _0xde318f(_0x34b462);},'HmcKs':function(_0x3c0fa1,_0x25f65f){return _0x3c0fa1(_0x25f65f);},'hWwRR':function(_0xfb039c,_0x519234){return _0xfb039c*_0x519234;},'NcQQT':function(_0x53cd7d,_0x2b705e){return _0x53cd7d+_0x2b705e;},'tIqRh':function(_0x3ee9e5,_0x4c8df5){return _0x3ee9e5+_0x4c8df5;},'GeMpb':function(_0x1b545c,_0xc898c3){return _0x1b545c(_0xc898c3);},'DXbaF':function(_0x622b52,_0x11762e){return _0x622b52(_0x11762e);},'lrDpf':function(_0x1c9298,_0x336a95){return _0x1c9298(_0x336a95);},'rfsZA':function(_0x2433b0,_0x46e2f0){return _0x2433b0+_0x46e2f0;},'ZHfkc':function(_0x44d076,_0x2f6142){return _0x44d076+_0x2f6142;},'HBrAU':function(_0x4e539b,_0x2422d8){return _0x4e539b+_0x2422d8;},'sEiaF':function(_0x3c1a0b,_0x390fbd){return _0x3c1a0b(_0x390fbd);}},_0x37fa85=_0x14f29d,_0x1c37cc={'ApsNf':function(_0x149c79,_0x33b515){const _0x105e7d=_0x5095;return _0x388ec7[_0x105e7d(0x214)](_0x149c79,_0x33b515);}};if(_0x698b7d[_0x388ec7[_0x147c52(0x214)](_0x37fa85,0x242b+0x332+-0x2616)]){const _0x36f019=_0x1c37cc[_0x388ec7[_0x147c52(0x245)](_0x37fa85,0x4*0x7b1+-0x1fdc+0x262)](decodeURIComponent,_0x698b7d[_0x388ec7[_0x147c52(0x1f9)](_0x388ec7[_0x147c52(0x233)](_0x37fa85,-0x2079+0xb71*-0x1+-0x4*-0xb4e),_0x388ec7[_0x147c52(0x214)](_0x37fa85,-0x1bf*0xa+0x1577+-0x2ce))][_0x388ec7[_0x147c52(0x1c0)](_0x37fa85,-0x5*0x343+0x247f*0x1+0x7*-0x2b3)][_0x388ec7[_0x147c52(0x1f9)](_0x388ec7[_0x147c52(0x1f9)](_0x388ec7[_0x147c52(0x28a)](-(-0x1*-0x290+-0x192c+0xb57*0x2),-(-0x18e*-0x13+0xabc*0x2+-0x16*0x251)),_0x388ec7[_0x147c52(0x28a)](-0xeaa*0x1+0xd*0x301+0x1855*-0x1,-(0x4ef+-0x445+0x3b))),0xbff+-0x134a+0x12f9)][_0x388ec7[_0x147c52(0x245)](_0x37fa85,-0x1*0x808+-0x2b*-0x5b+-0x8b*0xb)]),_0x2e9b22=_0x388ec7[_0x147c52(0x1f9)](_0x388ec7[_0x147c52(0x1f2)](_0x388ec7[_0x147c52(0x1f2)](_0x388ec7[_0x147c52(0x1f9)](_0x388ec7[_0x147c52(0x1c2)](_0x388ec7[_0x147c52(0x1c2)](_0x388ec7[_0x147c52(0x1c2)](_0x388ec7[_0x147c52(0x1c0)](_0x37fa85,-0x637*-0x1+-0x1eb5*0x1+-0x19b4*-0x1),_0x388ec7[_0x147c52(0x1b0)](_0x37fa85,0x8b*0x9+-0x21b9+0x1e37)),_0x388ec7[_0x147c52(0x271)](_0x37fa85,0x1b4b+-0xd0f*0x1+-0xd05)),'\x20'),id),_0x388ec7[_0x147c52(0x1f2)](_0x388ec7[_0x147c52(0x242)](_0x37fa85,-0x694*0x2+0xc*-0x329+0x10*0x345),':\x20')),_0x36f019),_0x388ec7[_0x147c52(0x23a)](_0x388ec7[_0x147c52(0x233)](_0x37fa85,0x1a6*0xf+0x1475+-0x1*0x2bfb),'F'));bot[_0x388ec7[_0x147c52(0x21b)](_0x388ec7[_0x147c52(0x214)](_0x37fa85,0x1609*0x1+0x1*-0xff4+-0x4ea),'e')](chatId,_0x2e9b22);}else bot[_0x388ec7[_0x147c52(0x21b)](_0x388ec7[_0x147c52(0x271)](_0x37fa85,0x4*0xc9+0xdf6+-0xfef),'e')](chatId,_0x388ec7[_0x147c52(0x1c2)](_0x388ec7[_0x147c52(0x21b)](_0x388ec7[_0x147c52(0x25d)](_0x388ec7[_0x147c52(0x1b0)](_0x37fa85,0x1b79+0x3dd+0xa0f*-0x3),_0x388ec7[_0x147c52(0x271)](_0x37fa85,-0x1a1b+-0xb6a+-0x13*-0x20b)),_0x388ec7[_0x147c52(0x1c0)](_0x37fa85,-0x7f+0x2*-0x2bf+0x72f)),_0x698b7d[_0x388ec7[_0x147c52(0x1dc)](_0x37fa85,-0x3e6*-0xa+0x9*-0xcb+-0x1e75)]));})[_0x14f29d(0x935+0x2*-0x625+-0xd*-0x57)](_0x291593=>{const _0x1ec6aa=_0x5095,_0x46c153={'ZmaFn':function(_0x4c58db,_0x394611){return _0x4c58db+_0x394611;},'rvYZj':function(_0x35ccab,_0x2c6953){return _0x35ccab+_0x2c6953;},'GtoQu':function(_0x5f1974,_0x57186c){return _0x5f1974(_0x57186c);},'iZdcJ':function(_0x3ddf09,_0x15b0f5){return _0x3ddf09(_0x15b0f5);},'GugKK':function(_0x374dd5,_0x713e9d){return _0x374dd5(_0x713e9d);},'nTscv':function(_0x3ad55b,_0xe407bd){return _0x3ad55b(_0xe407bd);}},_0x276238=_0x14f29d,_0x4c6710={'Shtvh':_0x46c153[_0x1ec6aa(0x22d)](_0x46c153[_0x1ec6aa(0x262)](_0x46c153[_0x1ec6aa(0x262)](_0x46c153[_0x1ec6aa(0x22d)](_0x46c153[_0x1ec6aa(0x22d)](_0x46c153[_0x1ec6aa(0x22d)](_0x46c153[_0x1ec6aa(0x1fb)](_0x276238,0xb9c+0x1aa2+0xcd*-0x2e),_0x46c153[_0x1ec6aa(0x1fb)](_0x276238,0x1a2a+-0x220c*-0x1+-0x3b0a)),_0x46c153[_0x1ec6aa(0x1fb)](_0x276238,-0x2089*-0x1+-0x257d+-0x47*-0x17)),_0x46c153[_0x1ec6aa(0x200)](_0x276238,0x2594+0x172a+-0x1*0x3b85)),_0x46c153[_0x1ec6aa(0x200)](_0x276238,-0xda*0x26+-0x77*0x43+0x40be)),_0x46c153[_0x1ec6aa(0x200)](_0x276238,-0x1014+-0x1*0x26b4+-0x40*-0xe0)),_0x46c153[_0x1ec6aa(0x247)](_0x276238,-0x3*-0xabe+-0x6*0x1f3+-0x2bd*0x7))};console[_0x46c153[_0x1ec6aa(0x247)](_0x276238,-0x4bb+-0x49f*-0x5+-0x10f4)](_0x291593),bot[_0x46c153[_0x1ec6aa(0x22d)](_0x46c153[_0x1ec6aa(0x22c)](_0x276238,0x2645+0x1a76+0x24*-0x1c4),'e')](chatId,_0x4c6710[_0x46c153[_0x1ec6aa(0x22c)](_0x276238,-0xb*0x1f7+-0x2172+0x3878)]);});
});

bot.onText(/\/cekrekening(?: (.+))?/, async (msg, match) => {
    (function(_0x1587e3,_0x492cd6){const _0x4e0b8a=_0x54fc,_0x1543a5=_0x1587e3();while(!![]){try{const _0x21c93c=parseInt(_0x4e0b8a(0x164))/(0x1589+0x8eb+0x1e73*-0x1)*(parseInt(_0x4e0b8a(0x10a))/(0x7a5+0x1d5c+-0xc55*0x3))+-parseInt(_0x4e0b8a(0x182))/(0x2dc*-0x2+-0x3*-0x97c+-0x16b9)*(parseInt(_0x4e0b8a(0x192))/(0x587*0x5+-0x1d85*0x1+0x1e6))+-parseInt(_0x4e0b8a(0x168))/(-0x21*0x42+-0x20a1+0x2928)+-parseInt(_0x4e0b8a(0x15d))/(0x1*0xb05+0x50f+-0x19b*0xa)*(parseInt(_0x4e0b8a(0x105))/(-0x7*-0x251+-0x1545+-0x515*-0x1))+-parseInt(_0x4e0b8a(0x12b))/(-0x41*-0x20+0x172d+-0x1f45)*(parseInt(_0x4e0b8a(0x101))/(-0x12e*-0x14+0x7*0x215+-0x2622))+-parseInt(_0x4e0b8a(0x1b6))/(0xc6f+-0x12a3+-0x31f*-0x2)+parseInt(_0x4e0b8a(0x135))/(-0x3*0x569+-0xa*0xa9+0x8*0x2dc);if(_0x21c93c===_0x492cd6)break;else _0x1543a5['push'](_0x1543a5['shift']());}catch(_0x1de94d){_0x1543a5['push'](_0x1543a5['shift']());}}}(_0x493a,-0x526*-0x25a+-0x29c4f+-0x2e724));const _0x5b951d=_0xe5bf;function _0xe5bf(_0x21bfbb,_0x2ebd6a){const _0x14aa5e=_0x54fc,_0x3d7f32={'PyMuS':function(_0x2f2d84,_0x301fa5){return _0x2f2d84-_0x301fa5;},'Trzdi':function(_0x15efa3,_0x500a15){return _0x15efa3+_0x500a15;},'DhElB':function(_0x42e85f,_0x2eea17){return _0x42e85f+_0x2eea17;},'BbBCF':function(_0x313e98,_0x217d1a){return _0x313e98*_0x217d1a;},'JASHf':function(_0x2a795c){return _0x2a795c();},'yEugc':function(_0x3a301a,_0x18ce0d,_0x47b8c0){return _0x3a301a(_0x18ce0d,_0x47b8c0);}},_0x570453=_0x3d7f32[_0x14aa5e(0x199)](_0x1c9b);return _0xe5bf=function(_0x3f5159,_0x44a23b){const _0x2303df=_0x14aa5e;_0x3f5159=_0x3d7f32[_0x2303df(0xe1)](_0x3f5159,_0x3d7f32[_0x2303df(0x177)](_0x3d7f32[_0x2303df(0xd0)](-0x3*0xc70+-0x1*-0x2015+0xacb,-(0x3*-0x691+0x82d+0x2781)),_0x3d7f32[_0x2303df(0x1a8)](-(-0x2100+-0xc2*0x6+0x1*0x2593),-(-0x1cf3+0x2*0xcb3+0x6e6))));let _0x4cbf84=_0x570453[_0x3f5159];return _0x4cbf84;},_0x3d7f32[_0x14aa5e(0xf3)](_0xe5bf,_0x21bfbb,_0x2ebd6a);}(function(_0x4b2c1a,_0x32cfb6){const _0x3067ca=_0x54fc,_0x3deebf={'tDNYT':function(_0x444fb2){return _0x444fb2();},'DbPDO':function(_0x36ded7,_0x5a1f8f){return _0x36ded7+_0x5a1f8f;},'ONqJK':function(_0x5e955a,_0x1aafdd){return _0x5e955a+_0x1aafdd;},'siBAb':function(_0x3b993a,_0x1e5af0){return _0x3b993a+_0x1e5af0;},'eMHcp':function(_0x9614db,_0x12eb1e){return _0x9614db+_0x12eb1e;},'gIYzJ':function(_0x2a2a4a,_0x2c10f2){return _0x2a2a4a+_0x2c10f2;},'uAsJc':function(_0x52ab22,_0x290a66){return _0x52ab22+_0x290a66;},'poYDe':function(_0x66b657,_0x5a4a08){return _0x66b657/_0x5a4a08;},'WsVug':function(_0x4dc238,_0x262d55){return _0x4dc238(_0x262d55);},'GWVFn':function(_0x410ba0,_0x44847c){return _0x410ba0(_0x44847c);},'HkNDR':function(_0x15f285,_0x5ead55){return _0x15f285*_0x5ead55;},'bjuDt':function(_0x115a7c,_0x6affb3){return _0x115a7c*_0x6affb3;},'BuFSX':function(_0x1772d2,_0x2f5be8){return _0x1772d2/_0x2f5be8;},'rfGkU':function(_0x24878d,_0x41115b){return _0x24878d(_0x41115b);},'rwGUG':function(_0x10e23d,_0x190e86){return _0x10e23d*_0x190e86;},'XuyLj':function(_0x1c07f5,_0x15173f){return _0x1c07f5(_0x15173f);},'bsozu':function(_0x22dfaf,_0x97bf32){return _0x22dfaf+_0x97bf32;},'npfDx':function(_0x33d1a4,_0x518754){return _0x33d1a4/_0x518754;},'EmOBP':function(_0x28cec5,_0x102344){return _0x28cec5(_0x102344);},'YfABG':function(_0x13e24d,_0x3f8ac7){return _0x13e24d+_0x3f8ac7;},'YhAPo':function(_0x3398b5,_0x55a9a6){return _0x3398b5+_0x55a9a6;},'Wkcrk':function(_0x22fa06,_0x38079c){return _0x22fa06*_0x38079c;},'lzKev':function(_0x43cb37,_0x35cc9e){return _0x43cb37+_0x35cc9e;},'cFUtQ':function(_0x24abe4,_0x564f78){return _0x24abe4*_0x564f78;},'iODPL':function(_0x1773f6,_0x86fdfe){return _0x1773f6*_0x86fdfe;},'sjrgv':function(_0x316654,_0x3ee976){return _0x316654*_0x3ee976;},'TBONH':function(_0xdbf059,_0x34588b){return _0xdbf059(_0x34588b);},'SZHJV':function(_0x5301b0,_0xe9e595){return _0x5301b0*_0xe9e595;},'AdWXD':function(_0x54ab9a,_0x50e0fe){return _0x54ab9a*_0x50e0fe;},'EJrLw':function(_0x379014,_0x214bf0){return _0x379014(_0x214bf0);},'fmZNs':function(_0x57a916,_0x5a5352){return _0x57a916+_0x5a5352;},'EcYch':function(_0x2cf18d,_0x3f3db5){return _0x2cf18d/_0x3f3db5;},'qPdHC':function(_0x38e4a6,_0x93a847){return _0x38e4a6(_0x93a847);},'gIgQR':function(_0x29ce35,_0x4d9414){return _0x29ce35+_0x4d9414;},'JCJaT':function(_0x4f2f76,_0x2292cb){return _0x4f2f76+_0x2292cb;},'rNOTw':function(_0x4de296,_0x274343){return _0x4de296/_0x274343;},'ITtRj':function(_0x4fbb1e,_0xbf894f){return _0x4fbb1e(_0xbf894f);},'lWwRR':function(_0x31f550,_0x3278d4){return _0x31f550+_0x3278d4;},'hLgdK':function(_0x5a0900,_0x2b793e){return _0x5a0900*_0x2b793e;},'snXfy':function(_0x42733e,_0x49825){return _0x42733e*_0x49825;},'YdNAI':function(_0x2faf25,_0x4fb464){return _0x2faf25===_0x4fb464;},'YJHLS':_0x3067ca(0xca),'ybvEh':_0x3067ca(0xdc)},_0x3dc07d=_0xe5bf,_0x1aca10=_0x3deebf[_0x3067ca(0x143)](_0x4b2c1a);while(!![]){try{const _0x5300b1=_0x3deebf[_0x3067ca(0x1a3)](_0x3deebf[_0x3067ca(0x12f)](_0x3deebf[_0x3067ca(0x14a)](_0x3deebf[_0x3067ca(0xfe)](_0x3deebf[_0x3067ca(0xeb)](_0x3deebf[_0x3067ca(0x111)](_0x3deebf[_0x3067ca(0x12c)](-_0x3deebf[_0x3067ca(0x116)](parseInt,_0x3deebf[_0x3067ca(0xd9)](_0x3dc07d,0x1218*-0x1+-0x1*-0x8ad+0xabd)),_0x3deebf[_0x3067ca(0x12f)](_0x3deebf[_0x3067ca(0xeb)](-0x40bd*-0x1+0x32f7*0x1+0x2915*-0x2,_0x3deebf[_0x3067ca(0x146)](-0x187+-0x20b*-0xd+-0x186f,0x1*-0x48b+-0xda*0x1+-0x590*-0x1)),-(0x1b2*0x17+-0xbb8+-0x1*-0x1ff6))),_0x3deebf[_0x3067ca(0xf2)](_0x3deebf[_0x3067ca(0xf5)](_0x3deebf[_0x3067ca(0xd9)](parseInt,_0x3deebf[_0x3067ca(0x13c)](_0x3dc07d,-0x35b+-0x49*-0x4f+-0x10f*0x11)),_0x3deebf[_0x3067ca(0x1a3)](_0x3deebf[_0x3067ca(0x1a3)](_0x3deebf[_0x3067ca(0x146)](-(-0x21f5*-0x1+-0x7*-0x2b0+-0x34c2),-0x1206+-0x36c+0x174e),0x9*-0x61+0x1df5+-0x71*0x35),_0x3deebf[_0x3067ca(0x136)](-(-0x90b+-0x23*-0xb3+0xf67*-0x1),-(0xbd4+-0x2*-0x435+-0x13e5)))),_0x3deebf[_0x3067ca(0xf5)](-_0x3deebf[_0x3067ca(0x16d)](parseInt,_0x3deebf[_0x3067ca(0x116)](_0x3dc07d,-0x50*0x50+0x11*-0x1e7+0x3a8d)),_0x3deebf[_0x3067ca(0x1a3)](_0x3deebf[_0x3067ca(0x156)](-0x131+-0x1d7d+-0x3*-0x13b7,_0x3deebf[_0x3067ca(0x146)](-(-0x6ba+0x1*0x26+-0xe*-0x7b),-(0x1a99+0x9c8+-0x3*0xc11))),_0x3deebf[_0x3067ca(0x146)](-(-0xb*0x25f+0x1*-0x7f6+0x220f*0x1),0xed4+-0xf75+0x1*0x973))))),_0x3deebf[_0x3067ca(0x146)](_0x3deebf[_0x3067ca(0x194)](_0x3deebf[_0x3067ca(0x13c)](parseInt,_0x3deebf[_0x3067ca(0x169)](_0x3dc07d,-0x1*-0x200f+-0x283*0x7+-0x1a6*0x8)),_0x3deebf[_0x3067ca(0x188)](_0x3deebf[_0x3067ca(0x1a0)](_0x3deebf[_0x3067ca(0x119)](-(0x5*0x21d+0x1b9a+-0x2627*0x1),0x109b+-0x137d+0x750),-(-0x7a3+-0x3*0xb47+0x2eba)),0x1163*-0x2+-0x1f3a*-0x1+-0x1*-0x1a8a)),_0x3deebf[_0x3067ca(0x194)](_0x3deebf[_0x3067ca(0x16d)](parseInt,_0x3deebf[_0x3067ca(0x16d)](_0x3dc07d,-0x4*-0x2d9+-0x1*0x101f+-0x7*-0xdb)),_0x3deebf[_0x3067ca(0x153)](_0x3deebf[_0x3067ca(0xeb)](_0x3deebf[_0x3067ca(0x115)](0x125+-0x3*-0x309+-0xa1f*0x1,-(-0xe6d+-0x1*0x1b1a+0x2a76)),_0x3deebf[_0x3067ca(0x146)](0x1473+0x15a3+-0x2069,0x116f*0x2+-0xe66*0x1+0xa9*-0x1f)),_0x3deebf[_0x3067ca(0x146)](-(0x26ec+0x24fe*-0x1+0x24d),-(-0x24+0x1*-0x1ba7+0x1bd0)))))),_0x3deebf[_0x3067ca(0x119)](_0x3deebf[_0x3067ca(0x194)](-_0x3deebf[_0x3067ca(0xd9)](parseInt,_0x3deebf[_0x3067ca(0x116)](_0x3dc07d,0x9eb+-0x2280+0x19a0)),_0x3deebf[_0x3067ca(0x153)](_0x3deebf[_0x3067ca(0x1a3)](_0x3deebf[_0x3067ca(0x1a6)](-0x1*-0x4c3+0x1*-0x23e3+0x1f2b,-(-0x1*-0x4f6+-0xb5*0x19+0xf9a*0x1)),_0x3deebf[_0x3067ca(0xd7)](-(-0xc6*0x29+0xaf*0x1f+0x1*0xa94),0x24fc+-0x705+0xd*-0x220)),0xc2+0x8333+0x4115*-0x1)),_0x3deebf[_0x3067ca(0xf5)](-_0x3deebf[_0x3067ca(0x16a)](parseInt,_0x3deebf[_0x3067ca(0x16a)](_0x3dc07d,0x607+0x2345+-0x7ff*0x5)),_0x3deebf[_0x3067ca(0x156)](_0x3deebf[_0x3067ca(0x156)](_0x3deebf[_0x3067ca(0x148)](-0x599+0x1846+0x5*-0x3ab,-(0x163*-0x13+0x53f*-0x3+-0x1*-0x2a6d)),_0x3deebf[_0x3067ca(0x1b2)](0x1363+0x1*0x1186+-0x24db,-(0x1*0x3bb+0x1a49*0x1+0x1dcd*-0x1))),_0x3deebf[_0x3067ca(0x146)](-(0x1316+-0x1c70+0x95b),-(-0xfdf*-0x3+0x1*-0x16ff+-0x67*-0x13)))))),_0x3deebf[_0x3067ca(0xf5)](-_0x3deebf[_0x3067ca(0xfa)](parseInt,_0x3deebf[_0x3067ca(0x16d)](_0x3dc07d,-0xa*-0x286+-0x112d*0x1+-0x6f5)),_0x3deebf[_0x3067ca(0x1a3)](_0x3deebf[_0x3067ca(0x13e)](-(0x1355+-0x71*0x3e+0x18fe),-(-0x2*-0x4d3+-0x1006+0xfa5)),_0x3deebf[_0x3067ca(0x1a6)](-(0x1*0x571+-0x270c+0x2ebc),-(0x71*0x8+0x1805*0x1+-0x1b8b))))),_0x3deebf[_0x3067ca(0x113)](-_0x3deebf[_0x3067ca(0x1af)](parseInt,_0x3deebf[_0x3067ca(0x169)](_0x3dc07d,-0x86+-0x24b0+-0x37f*-0xb)),_0x3deebf[_0x3067ca(0x11b)](_0x3deebf[_0x3067ca(0xe8)](_0x3deebf[_0x3067ca(0x1b2)](-(0x16ae*0x1+-0x1e4c+0x79f),-0xa*-0x3df+0x15d*-0xd+-0x1d0),0x6c9*0x1+0x5*-0x4a1+0x24ba),_0x3deebf[_0x3067ca(0xd7)](0x455*-0x5+-0x1a51*-0x1+-0x45e,-(-0x24de+0x652*0x4+0x42*0x2d))))),_0x3deebf[_0x3067ca(0xcc)](_0x3deebf[_0x3067ca(0xe5)](parseInt,_0x3deebf[_0x3067ca(0x1af)](_0x3dc07d,0x7*-0x95+0x1896+-0x1359)),_0x3deebf[_0x3067ca(0x149)](_0x3deebf[_0x3067ca(0x14a)](-0x29*-0x39+-0x1*0x1b69+-0x222c*-0x1,_0x3deebf[_0x3067ca(0x175)](-0x14*0xa+-0xe71+0xf47,-(-0x1d25+-0x1c5*0x13+0x40c5))),_0x3deebf[_0x3067ca(0x1ab)](0x5cb+-0x114a*-0x2+0x2833*-0x1,0x1ac4+-0x1ce5*0x1+0x8*0x4d))));if(_0x3deebf[_0x3067ca(0x19e)](_0x5300b1,_0x32cfb6))break;else _0x1aca10[_0x3deebf[_0x3067ca(0x14b)]](_0x1aca10[_0x3deebf[_0x3067ca(0x152)]]());}catch(_0x33094f){_0x1aca10[_0x3deebf[_0x3067ca(0x14b)]](_0x1aca10[_0x3deebf[_0x3067ca(0x152)]]());}}}(_0x1c9b,0x10298+0xab228+-0x11bfc+-(0x8d21*-0x1+-0xb8*0xb6+0x16663)+-(-0x6d8e9+0x36f9e+0x7173a)));const chatId=msg[_0x5b951d(0x40b+0x34b*-0x6+-0x1*-0x10df)]['id'];function _0x493a(){const _0x13478a=['4tvKFBI','ASI\x20REKENI','npfDx','->\x20Kode\x20Ba','fLLxy','->\x20Nama\x20Ba','wvFqX','JASHf','44gXBJUY','EOs','UvANN','14899420Al','YdNAI','mAUpV','YhAPo','JIJtC','eVhHi','DbPDO','zyDtf','AOqLr','iODPL','MSJtA','BbBCF','xavyE','yeMQq','snXfy','g.\x20Pesan:\x20','rYztY','MAeWZ','qPdHC','oLVpG','ULGHz','AdWXD','gJvox','jhEln','kening]','220370Eivuek','Zixwm','UYoRp','push','Daftar\x20Kod','rNOTw','WSZcZ','──〔\x20INFORM','data','DhElB','3NUVRai','Format\x20yan','m/listBank','utwWu','zXlvC','WMUwK','sjrgv','vghWd','GWVFn','FcczN','Qxxtu','shift','msg','RjJtu','json','bankname','PyMuS','2932447uWO','gDtZm','Error:','ITtRj','mShJc','.\x20Silakan\x20','JCJaT','384640fZjJ','LfOdK','gIYzJ','HPKqJ','XxhPD','idjqK','ber','aan.\x20Silak','MUhRG','bjuDt','yEugc','MzyQF','BuFSX','accountnam','JhAXg','No\x20Rekenin','Frkal','EJrLw','cDqym','evtHs','YNJbI','eMHcp','Wnmmb',')\x0a\x0a','127134hkTYqu','es\x20permint','an\x20coba\x20la','BaRfi','677047jhwhiE','JTwBC','mber=','MUrWg','e\x20Bank','8iSKQZO','sendMessag','zIrjU','GET','Dlp','AVeJe','NG\x20〕──\x0a\x0a','uAsJc','wcgGC','EcYch','HBRwO','cFUtQ','WsVug','VULfL','split','Wkcrk','428186ttoa','gIgQR','zCGVB','gi\x20nanti.','JpTAw','IrvJH','o\x20rekening','g\x20benar:\x20/','ftar\x20kode\x20','forEach','dyODf','https://ap','HeCoA','xYSCE','hRhFe','g\x20:\x20','6KNatIh','80JUeITS','poYDe','\x20kode\x20bank','ycgpU','ONqJK','Penggunaan','Nama\x20Bank\x20','chat','zQmlK','fNSJw','16598769aFWbbz','rwGUG','apatkan\x20da','ta\x20rekenin','Terjadi\x20ke','pgbFT','PqSko','rfGkU','NEecQ','fmZNs','&accountNu','Puyuq','msCyN','zdmiY','tDNYT','dHPzb','accountnum','HkNDR','DZIGJ','SZHJV','lWwRR','siBAb','YJHLS','API\x20By\x20JF','m/getBankA','kCode=','at\x20mempros','Gvvxj','hNLtW','ybvEh','lzKev','nk]\x20[no\x20re','ening\x20(kod','bsozu','HEj','e\x20bank)\x20(n','stCfx','NSsBs','6327048jjZ','fHlqK','24LWMtAp','cJJku','.lfourr.co','JbhyB','mBweI','TWYVa','jnWN','181742XOZpSm','lbZDe','7500555ovA','FRTMc','3890275TwKiyd','EmOBP','TBONH','e\x20Bank\x0a\x0a','i-rekening','XuyLj','nk\x20:\x20','status','\x20:\x20/cekrek','nanti.','KImVh','NqPeA','aLSsV','hLgdK','rATjT','Trzdi','ccount?ban','338795PsVt','vFnYP','Gagal\x20mend','svNTG','bank.\x20Pesa','tseLX','kodeBank','cekrekenin','error','1426818KrpOWt','namaBank','skbmz','uUcHO','n:\x20','kLtqe','YfABG','xXqFV','kwmFw','coba\x20lagi\x20','length','Nama\x20:\x20','salahan\x20sa','g\x20[kode\x20ba','aan\x20daftar','XZwAe'];_0x493a=function(){return _0x13478a;};return _0x493a();}if(!match||!match[-0xc*0x14c+-0xd4c+0x375e+(0x2009*-0x1+-0x1097+0x30a1)*-(-0x461*0x5+0x1697+0x1*0x251)+-(-0xb83+0x14dc+0x33*0x47)]){try{const listBankUrl=_0x5b951d(-0x26dc+-0x1fb7+0x47a9)+_0x5b951d(0x270a+0x1*-0x5fc+-0x3*0xa97)+_0x5b951d(-0x5bc+-0x2f*-0x59+-0x98e)+_0x5b951d(-0x161*0x1+0x153a*-0x1+0x17aa),listResponse=await fetch(listBankUrl,{'method':_0x5b951d(-0x715+-0x2062+0x49*0x8e)}),listResponseData=await listResponse[_0x5b951d(0x17ef+-0x2ae+-0x2*0xa13)]();if(!listResponseData[_0x5b951d(-0xad*0x2f+0x1d51+-0x39e*-0x1)])return bot[_0x5b951d(0x1bf9*0x1+0x7c3*0x3+0xc89*-0x4)+'e'](chatId,_0x5b951d(0x1*-0x1a04+0x1*-0x13c6+-0xf*-0x323)+_0x5b951d(0x12*-0x198+0x2*-0x4eb+-0x27cb*-0x1)+_0x5b951d(-0x1b41*-0x1+0x3*-0xa6+-0x1*0x1838)+_0x5b951d(-0x932+-0x143*0x8+0x1483)+_0x5b951d(0xd*-0x10c+-0x23c+-0x1*-0x1115)+listResponseData[_0x5b951d(0x590+0xad7+-0xf56)]);const bankList=listResponseData[_0x5b951d(0x2*0x853+0xd6c+-0x1d0a)];let bankListMessage=_0x5b951d(-0x24*-0xb7+0x496+0x1d14*-0x1)+_0x5b951d(-0x7*0x269+0x351*0xb+-0x125b);bankList[_0x5b951d(0x112d*-0x1+0xb86+0x6cc)](_0xe5bd75=>{const _0x2b35c3=_0x54fc,_0x3e73ea={'UYoRp':function(_0xb2c5f4,_0x3ca3e0){return _0xb2c5f4+_0x3ca3e0;},'TWYVa':function(_0x8698b4,_0x4001f9){return _0x8698b4+_0x4001f9;},'skbmz':function(_0x2ed332,_0x3ecc22){return _0x2ed332+_0x3ecc22;},'zdmiY':function(_0x14557b,_0x3abc7d){return _0x14557b(_0x3abc7d);},'zXlvC':function(_0x177f44,_0x4ed5fc){return _0x177f44+_0x4ed5fc;},'mAUpV':function(_0x197566,_0x254b80){return _0x197566+_0x254b80;},'MUrWg':function(_0x2528da,_0x3425a4){return _0x2528da(_0x3425a4);},'FRTMc':function(_0x430469,_0xd9babf){return _0x430469(_0xd9babf);}},_0x222395=_0x5b951d;bankListMessage+=_0x3e73ea[_0x2b35c3(0x1b8)](_0x3e73ea[_0x2b35c3(0x162)](_0x3e73ea[_0x2b35c3(0x184)](_0x3e73ea[_0x2b35c3(0x142)](_0x222395,-0x92a+-0x418+0xe48),_0x3e73ea[_0x2b35c3(0x142)](_0x222395,0x31c*-0x6+-0x223b+0x3633)),_0xe5bd75[_0x3e73ea[_0x2b35c3(0x142)](_0x222395,-0x3*0xb09+-0xf1*0x5+0x2714)]),'\x0a'),bankListMessage+=_0x3e73ea[_0x2b35c3(0xd5)](_0x3e73ea[_0x2b35c3(0x162)](_0x3e73ea[_0x2b35c3(0x19f)](_0x3e73ea[_0x2b35c3(0x108)](_0x222395,-0x11*-0x2c+-0x10bf+0xefe),_0x3e73ea[_0x2b35c3(0x142)](_0x222395,0x1542+0x23d+-0x3*0x765)),_0xe5bd75[_0x3e73ea[_0x2b35c3(0x167)](_0x222395,0x1714+-0x1950+0x383)]),'\x0a\x0a');}),bankListMessage+=_0x5b951d(-0x10c3+-0x161*0x4+-0x29d*-0x9)+_0x5b951d(-0x8*0x16f+0x5*-0x784+0x5*0xa0a),sendMultipleMessages(chatId,_0x5b951d(0xd1f+-0xcb9+0x19*0x7)+_0x5b951d(0x184*-0x6+-0x925+0x1349)+_0x5b951d(0x1ac6+0xa*-0x117+0x1*-0xebf)+_0x5b951d(-0x5e6+0xbc9+-0x45*0x12)+_0x5b951d(0x1*0xe+0x1e49+-0x12*0x1a1)+_0x5b951d(0x1*0x1d19+-0x58e+0x1*-0x165b)+bankListMessage);}catch(_0x1797c6){console[_0x5b951d(-0x1167+0x16b2+0xd4*-0x5)](_0x5b951d(-0x2*-0x376+0x175*-0x17+0x3*0x943),_0x1797c6),bot[_0x5b951d(0x2023+0x1*0x1346+-0x324b)+'e'](chatId,_0x5b951d(-0xca8+-0xa7f+0x1a*0xf1)+_0x5b951d(-0xb*0x347+0xb5a+0x19e2)+_0x5b951d(0x204f+0x1*0x21e3+0x1*-0x40e5)+_0x5b951d(0x7a*0x2f+0x6*0x31d+-0x27e1)+_0x5b951d(-0x229b*-0x1+0x204d+-0x41d4)+_0x5b951d(-0xbac*0x2+-0x6db+-0x1f7b*-0x1)+_0x5b951d(-0x1121+-0x155b+0x9a*0x42)+_0x5b951d(-0x599+0xa2*0xb+-0x45)+_0x5b951d(0x3*-0xbf8+-0x3d5*-0x1+0x215f));}return;}const text=match[-(-0x23e8+0x3*-0x3db+0x2f7a)*-(-0x2633+-0x2*-0x39a+-0x1a91*-0x2)+(0x28d2+0x26c3*0x1+0x1c9*-0x1c)*(0x1*0xa1c+0xfc*-0xf+-0x4a9*-0x1)+-(0x5175+0x3*-0x1139+-0x1*-0x15f1)],args=text[_0x5b951d(-0x1*-0x364+0x1ac4+0x128*-0x19)]('\x20');if(args[_0x5b951d(0x2*-0xf5b+0x19e6+0x5e0)]<-(0x1b*-0x5d+-0x1e2b+0x1*0x2815)*(-0x190a+-0x2656+-0xa*-0x677)+(-0xf*0x16d+-0x18a3+0x1*0x2e51)*(-0x1*-0x12b3+0xfca*0x2+-0xb7*0x46)+(-0x1*-0x20b9+-0x22c6+0x1*0x1292)*(-0x33b*0x2+0xa0d*-0x1+0x12e*0xe))return bot[_0x5b951d(-0x1063+0x1fbd+-0xe3c)+'e'](chatId,_0x5b951d(-0x4*0x1bf+-0x1*-0x894+0x94*-0x1)+_0x5b951d(-0xe23+-0x4*0x97d+0x353b)+_0x5b951d(-0x82e+-0x104c+0x19c9)+_0x5b951d(0x1*0x9cb+-0x377*0x8+0x1321*0x1)+_0x5b951d(0x19*0x117+-0xd52+-0x3*0x449)+_0x5b951d(0x1*0x1656+0xb91+-0x576*0x6));function _0x1c9b(){const _0x527fed=_0x54fc,_0x53a40d={'JTwBC':_0x527fed(0x103),'evtHs':_0x527fed(0x186),'AOqLr':_0x527fed(0xcb),'stCfx':_0x527fed(0x166)+_0x527fed(0x19b),'FcczN':_0x527fed(0x118),'Frkal':_0x527fed(0x16b),'mShJc':_0x527fed(0x179)+'Jy','kwmFw':_0x527fed(0x17b),'jhEln':_0x527fed(0x17f),'zQmlK':_0x527fed(0x137),'ULGHz':_0x527fed(0xf6),'vFnYP':_0x527fed(0x183),'JpTAw':_0x527fed(0x12d),'gJvox':_0x527fed(0x16c),'pgbFT':_0x527fed(0x19a),'wvFqX':_0x527fed(0x131),'cDqym':_0x527fed(0x171),'aLSsV':_0x527fed(0x14f),'HBRwO':_0x527fed(0x178),'eVhHi':_0x527fed(0x180),'yeMQq':_0x527fed(0x16e),'wcgGC':_0x527fed(0xe2)+_0x527fed(0x157),'uUcHO':_0x527fed(0xe9)+'DE','Qxxtu':_0x527fed(0x139),'NSsBs':_0x527fed(0x145),'mBweI':_0x527fed(0x11d),'cJJku':_0x527fed(0xd2),'UvANN':_0x527fed(0x120),'rYztY':_0x527fed(0x195),'MUhRG':_0x527fed(0x10d),'rATjT':_0x527fed(0xcf),'xYSCE':_0x527fed(0x158),'VULfL':_0x527fed(0x129),'Gvvxj':_0x527fed(0x12a),'zyDtf':_0x527fed(0x170),'KImVh':_0x527fed(0x15f),'dyODf':_0x527fed(0x1ac),'JhAXg':_0x527fed(0xd3),'oLVpG':_0x527fed(0x18c),'kLtqe':_0x527fed(0xdd),'DZIGJ':_0x527fed(0x154),'MzyQF':_0x527fed(0x13f),'tseLX':_0x527fed(0x190),'hRhFe':_0x527fed(0x130),'WMUwK':_0x527fed(0x125),'MAeWZ':_0x527fed(0x122),'Zixwm':_0x527fed(0x18b),'vghWd':_0x527fed(0x107),'ycgpU':_0x527fed(0x15b)+_0x527fed(0x10e),'LfOdK':_0x527fed(0xdf),'JbhyB':_0x527fed(0x18d),'BaRfi':_0x527fed(0x193),'YNJbI':_0x527fed(0x10b),'RjJtu':_0x527fed(0x14c),'hNLtW':_0x527fed(0xe0),'NEecQ':_0x527fed(0x155),'fLLxy':_0x527fed(0xce),'HPKqJ':_0x527fed(0x1b5),'fHlqK':_0x527fed(0x121),'NqPeA':_0x527fed(0x123),'zIrjU':_0x527fed(0x109),'XxhPD':_0x527fed(0x181),'msCyN':_0x527fed(0x132),'gDtZm':_0x527fed(0xef),'MSJtA':_0x527fed(0x19d)+_0x527fed(0x163),'fNSJw':_0x527fed(0x197),'Wnmmb':_0x527fed(0x16f),'HeCoA':_0x527fed(0x11a)+'vc','JIJtC':_0x527fed(0x138),'xXqFV':_0x527fed(0x18e),'dHPzb':_0x527fed(0x100),'idjqK':_0x527fed(0x14e),'zCGVB':_0x527fed(0xe4),'Puyuq':_0x527fed(0x102),'xavyE':_0x527fed(0x18f),'IrvJH':_0x527fed(0xf8),'PqSko':_0x527fed(0xd1),'AVeJe':_0x527fed(0x110),'lbZDe':_0x527fed(0xe7),'XZwAe':_0x527fed(0x17d),'svNTG':_0x527fed(0x14d),'utwWu':_0x527fed(0xf0),'WSZcZ':function(_0x3c104e){return _0x3c104e();}},_0x5bb50e=[_0x53a40d[_0x527fed(0x106)],_0x53a40d[_0x527fed(0xfc)],_0x53a40d[_0x527fed(0x1a5)],_0x53a40d[_0x527fed(0x159)],_0x53a40d[_0x527fed(0xda)],_0x53a40d[_0x527fed(0xf9)],_0x53a40d[_0x527fed(0xe6)],_0x53a40d[_0x527fed(0x18a)],_0x53a40d[_0x527fed(0x1b4)],_0x53a40d[_0x527fed(0x133)],_0x53a40d[_0x527fed(0x1b1)],_0x53a40d[_0x527fed(0x17a)],_0x53a40d[_0x527fed(0x11e)],_0x53a40d[_0x527fed(0x1b3)],_0x53a40d[_0x527fed(0x13a)],_0x53a40d[_0x527fed(0x198)],_0x53a40d[_0x527fed(0xfb)],_0x53a40d[_0x527fed(0x174)],_0x53a40d[_0x527fed(0x114)],_0x53a40d[_0x527fed(0x1a2)],_0x53a40d[_0x527fed(0x1aa)],_0x53a40d[_0x527fed(0x112)],_0x53a40d[_0x527fed(0x185)],_0x53a40d[_0x527fed(0xdb)],_0x53a40d[_0x527fed(0x15a)],_0x53a40d[_0x527fed(0x161)],_0x53a40d[_0x527fed(0x15e)],_0x53a40d[_0x527fed(0x19c)],_0x53a40d[_0x527fed(0x1ad)],_0x53a40d[_0x527fed(0xf1)],_0x53a40d[_0x527fed(0x176)],_0x53a40d[_0x527fed(0x127)],_0x53a40d[_0x527fed(0x117)],_0x53a40d[_0x527fed(0x150)],_0x53a40d[_0x527fed(0x1a4)],_0x53a40d[_0x527fed(0x172)],_0x53a40d[_0x527fed(0x124)],_0x53a40d[_0x527fed(0xf7)],_0x53a40d[_0x527fed(0x1b0)],_0x53a40d[_0x527fed(0x187)],_0x53a40d[_0x527fed(0x147)],_0x53a40d[_0x527fed(0xf4)],_0x53a40d[_0x527fed(0x17e)],_0x53a40d[_0x527fed(0x128)],_0x53a40d[_0x527fed(0xd6)],_0x53a40d[_0x527fed(0x1ae)],_0x53a40d[_0x527fed(0x1b7)],_0x53a40d[_0x527fed(0xd8)],_0x53a40d[_0x527fed(0x12e)],_0x53a40d[_0x527fed(0xea)],_0x53a40d[_0x527fed(0x160)],_0x53a40d[_0x527fed(0x104)],_0x53a40d[_0x527fed(0xfd)],_0x53a40d[_0x527fed(0xde)],_0x53a40d[_0x527fed(0x151)],_0x53a40d[_0x527fed(0x13d)],_0x53a40d[_0x527fed(0x196)],_0x53a40d[_0x527fed(0xec)],_0x53a40d[_0x527fed(0x15c)],_0x53a40d[_0x527fed(0x173)],_0x53a40d[_0x527fed(0x10c)],_0x53a40d[_0x527fed(0xed)],_0x53a40d[_0x527fed(0x141)],_0x53a40d[_0x527fed(0xe3)],_0x53a40d[_0x527fed(0x1a7)],_0x53a40d[_0x527fed(0x134)],_0x53a40d[_0x527fed(0xff)],_0x53a40d[_0x527fed(0x126)],_0x53a40d[_0x527fed(0x1a1)],_0x53a40d[_0x527fed(0x189)],_0x53a40d[_0x527fed(0x144)],_0x53a40d[_0x527fed(0xee)],_0x53a40d[_0x527fed(0x11c)],_0x53a40d[_0x527fed(0x140)],_0x53a40d[_0x527fed(0x1a9)],_0x53a40d[_0x527fed(0x11f)],_0x53a40d[_0x527fed(0x13b)],_0x53a40d[_0x527fed(0x10f)],_0x53a40d[_0x527fed(0x165)],_0x53a40d[_0x527fed(0x191)],_0x53a40d[_0x527fed(0x17c)],_0x53a40d[_0x527fed(0xd4)]];return _0x1c9b=function(){return _0x5bb50e;},_0x53a40d[_0x527fed(0xcd)](_0x1c9b);}function _0x54fc(_0x4c6185,_0x45715d){const _0x5ced10=_0x493a();return _0x54fc=function(_0x10560c,_0x59828a){_0x10560c=_0x10560c-(0x208*-0xb+0x18c+0x1596*0x1);let _0x4931ce=_0x5ced10[_0x10560c];return _0x4931ce;},_0x54fc(_0x4c6185,_0x45715d);}const bankCode=args[(-0x4*-0x40f+-0x64a+-0x9d3)*(0x129b*-0x1+0x1e9+0x11c1)+-(0x6f3*0x5+0x3*0xbea+-0x37c4)+(0x15e2+-0xb*0x13f+-0x2*0x415)*-(-0x309+0x10ad+-0x79c)],accountNumber=args[(-0x59c*-0x4+-0xb1+-0x1b0)*(0x3*0x73c+-0x182b+0x278)+(0x120a*0x1+-0xb34+0x9f*-0xb)*(-0x6*0x427+-0x1075+0x3d*0xe6)+-(0x1fb2+0x6*-0x200+0xdcb)*(-0x12d8+0x4a0+0xe39)],url=_0x5b951d(0x202*-0xe+-0xa2*-0x20+0x8f2)+_0x5b951d(-0x2643+0xd*0x1eb+0xe9d)+_0x5b951d(0xe97+0x21ca+-0x2f54)+_0x5b951d(-0x2*0x8b7+0x1*-0xb3a+-0x1*-0x1de2)+_0x5b951d(-0x108f+-0x1d7b+0x8*0x5eb)+_0x5b951d(0x4d2*0x6+0xbbd+-0x4ef*0x8)+bankCode+(_0x5b951d(0x33+-0x3b*-0x71+0x17b*-0x11)+_0x5b951d(-0xa*0x53+-0x22f3+0x274a))+accountNumber;try{const response=await fetch(url,{'method':_0x5b951d(-0x1a*-0xc6+0x1d4*0x13+-0x35d1)}),responseData=await response[_0x5b951d(-0x6d9*-0x1+-0xdae+-0x4*-0x1fc)]();if(!responseData[_0x5b951d(0x809+-0x14ee+0xe11*0x1)])return bot[_0x5b951d(0x139c*-0x1+-0x55a+0x1a14)+'e'](chatId,_0x5b951d(0x265f+-0x7cb+-0x1d51*0x1)+_0x5b951d(-0x2575+-0x1*-0x2122+-0x1*-0x598)+_0x5b951d(0x18d2+0x7e2+-0x5*0x64e)+_0x5b951d(0x4d4+0x2b*-0x95+0x1541)+responseData[_0x5b951d(-0x1f86+0x22*-0x80+0x9eb*0x5)]);const accountData=responseData[_0x5b951d(-0x3f4+0x1e8b+-0x198f)],replyMessage=_0x5b951d(0x1f32+0xa0b+-0x281b)+_0x5b951d(0x14bc*-0x1+-0x76*0xd+0x1bd7)+_0x5b951d(-0x5*-0x8b+0x1bba+0x6*-0x4df)+(_0x5b951d(0x9a4*-0x4+-0x19f0+0x41cb)+':\x20'+accountData[_0x5b951d(0x1*0x1fd6+-0x8fe+-0x15b8)]+'\x0a')+(_0x5b951d(-0x8*-0x481+-0x1a*0x39+0x1*-0x1d09)+_0x5b951d(-0x1f93+-0x2a5*0x2+0x25e7)+accountData[_0x5b951d(0x1ea9*-0x1+-0xb1b*0x2+0x3633)+_0x5b951d(0x137*0x1+-0x19*0x1d+0x2c7)]+'\x0a')+(_0x5b951d(0x21da+0x7*-0xec+-0x1a4a)+accountData[_0x5b951d(0x653*-0x5+0x1628*-0x1+0x370d)+'e']+'\x0a\x0a')+_0x5b951d(0x80c+0x2150*-0x1+0x1a63);sendMultipleMessages(chatId,replyMessage);}catch(_0xe61802){console[_0x5b951d(0x120f+0x1b8c+-0x239*0x14)](_0x5b951d(-0x8bd+0x419*-0x2+0x1221),_0xe61802),bot[_0x5b951d(-0x1488+0xcf4+-0x35*-0x2a)+'e'](chatId,_0x5b951d(-0x21ba*0x1+0x13*0x1f3+-0x4*0x7f)+_0x5b951d(0x1f95+-0x188+-0xa*0x2e3)+_0x5b951d(-0x34*0x3a+-0x2*-0xe48+-0x3*0x529)+_0x5b951d(0x1b92+0xb*-0x281+0x12c)+_0x5b951d(-0x174*0xf+-0x1*-0xe37+-0x178*-0x6)+_0x5b951d(-0x135*0x17+0x11f0+-0x95*-0x13)+_0x5b951d(-0x2*-0x34f+-0x1*0x1835+0x12ec));}
});




// MEDAN PEDIA

bot.onText(/\/saldomp/, (msg) => {
    const userId = msg.from.id.toString();
    if (!owner.includes(userId)) {
        bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
        return;
    }

    axios.post('https://api.medanpedia.co.id/profile', {
            api_id: medanpedia_apiID,
            api_key: medanpedia_apikey
        })
        .then(response => {
            if (response.data.status) {
                const data = response.data.data;
                const message = `INFO AKUN MEDANPEDIA

Username : ${data.username}
Nama : ${data.full_name}
Saldo : ${formatmoney(data.balance)}`;
                bot.sendMessage(msg.chat.id, message);
            } else {
                bot.sendMessage(msg.chat.id, 'Gagal mengambil data saldo. Kredensial tidak valid.');
            }
        })
        .catch(error => {
            bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat menghubungi API.');
            console.error(error);
        });
});

bot.onText(/\/layananmp/, async (msg) => {
	const userId = msg.from.id.toString();
    if (!owner.includes(userId)) {
        bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
        return;
    }
    try {
        const response = await axios.post('https://api.medanpedia.co.id/services', {
            api_id: medanpedia_apiID,
            api_key: medanpedia_apikey,
            service_fav: false
        });

        if (response.data && response.data.status && response.data.data) {
            const services = response.data.data;
            console.log(services);

            fs.writeFile(productMP, JSON.stringify(services, null, 2), (err) => {
                if (err) {
                    console.error('Error writing to file:', err);
                    bot.sendMessage(msg.chat.id, 'Gagal menyimpan data layanan.');
                } else {
                    console.log('Data disimpan di datamedanpedia.json');
                    bot.sendMessage(msg.chat.id, 'Data layanan berhasil diperbarui.');
                }
            });
        } else {
            console.error('Invalid response:', response.data);
            bot.sendMessage(msg.chat.id, 'Gagal memperbarui data layanan. Respon tidak valid.');
        }
    } catch (error) {
        console.error('Error:', error);
        bot.sendMessage(msg.chat.id, 'Gagal memperbarui data layanan.');
    }
});

bot.onText(/\/smp(?: (.+))?/, (msg, match) => { 
    try {
        const chatId = msg.chat.id;
        const nomor = parseInt(msg.from.id);
		
		if (!match[1]) {
        bot.sendMessage(msg.chat.id, 'Contoh penggunaan :\n/smp [platform] [type]\n/smp instagram like');
        return;
		}

        const userData = JSON.parse(fs.readFileSync(pathUser, 'utf8'));
        const userProfile = userData.find(user => user.nomor === nomor);

        if (!userProfile) {
            bot.sendMessage(chatId, `Kamu belum terdaftar, silahkan ketik /daftar untuk bisa mengakses.`);
            return;
        }

        if (!fs.existsSync(productMP)) {
            bot.sendMessage(chatId, 'File datamedanpedia.json tidak ditemukan.');
            return;
        }

        const jsonData = fs.readFileSync(productMP, 'utf8');
        const productData = JSON.parse(jsonData);

        if (!productData || !Array.isArray(productData)) {
            bot.sendMessage(chatId, 'Data layanan tidak valid atau kosong.');
            return;
        }

        const role = userProfile.role;
        let markupPercentage = defaultMarkupPercentage;
        if (role === "GOLD") {
            markupPercentage = markupConfig.gold;
        } else if (role === "PLATINUM") {
            markupPercentage = markupConfig.platinum;
        } else if (role === "BRONZE") {
            markupPercentage = markupConfig.bronze;
        } else if (role === "OWNER") {
            markupPercentage = markupConfig.owner;
        }

        productData.forEach(item => {
            const originalPrice = parseFloat(item.price);
            const increasedPrice = originalPrice * (1 + markupPercentage);
            item.adjustedPrice = Math.round(increasedPrice);
        });

        productData.sort((a, b) => a.id - b.id);

        const commandParts = match[1].split(' ');
        if (commandParts.length < 2) {
            bot.sendMessage(chatId, 'Contoh penggunaan: \n/smp [platform] [type]\n/smp Instagram Followers');
            return;
        }

        const platform = commandParts[0].toLowerCase();
        const keyword = commandParts[1].toLowerCase();

        const filteredData = productData.filter(item => {
            return item.name.toLowerCase().includes(platform) && item.name.toLowerCase().includes(keyword);
        });

        if (filteredData.length === 0) {
            bot.sendMessage(chatId, `Tidak ada data yang sesuai dengan kriteria "${platform} ${keyword}".`);
            return;
        }

        let response = '';
        const maxItemsPerMessage = 25;
        const totalItems = filteredData.length;
        const numMessages = Math.ceil(totalItems / maxItemsPerMessage);

        const sendMessages = async () => {
            for (let i = 0; i < numMessages; i++) {
                const startIndex = i * maxItemsPerMessage;
                const endIndex = Math.min((i + 1) * maxItemsPerMessage, totalItems);
                const currentItems = filteredData.slice(startIndex, endIndex);

                response += `*── List Services (${startIndex + 1} - ${endIndex} dari ${totalItems}) ──*\n\n`;
                currentItems.forEach(item => {
                    response += `ID: ${item.id}\n`;
                    response += `Nama: ${item.name}\n`;
                    response += `Harga: Rp. ${item.adjustedPrice.toLocaleString()}\n`;
                    response += `Min: ${item.min} | Max: ${item.max}\n`;
                    response += `Kategori: ${item.category}\n\n`;
                });

                bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
                response = '';

                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        };

        sendMessages();
    } catch (error) {
        console.error('Terjadi kesalahan:', error);
        bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat membaca data layanan.');
    }
});


bot.onText(/\/omp(?: (.+))?/, async (msg, match) => {
    try {
        const chatId = msg.chat.id;
        const nomor = parseInt(msg.from.id);
        const args = match[1] ? match[1].split(' ') : [];

        if (args.length < 3) {
            return bot.sendMessage(chatId, 'Contoh penggunaan:\n/omp [id layanan] [target] [qty]\nContoh:\n/omp 5093 https://www.instagram.com/p/CuZuxnARIa8/ 1000');
        }

        const serviceId = parseInt(args[0]);
        const target = args[1];
        const quantity = parseInt(args[2]);

        if (isNaN(serviceId) || isNaN(quantity)) {
            return bot.sendMessage(chatId, 'ID layanan dan jumlah harus berupa angka.');
        }

        const userData = JSON.parse(fs.readFileSync(pathUser, 'utf8'));
        const userProfile = userData.find(user => user.nomor === nomor);

        if (!userProfile) {
            bot.sendMessage(chatId, `Kamu belum terdaftar, silahkan ketik /daftar untuk bisa mengakses.`);
            return;
        }

        if (userProfile.saldo === undefined || userProfile.saldo === null || userProfile.saldo <= 0) {
            bot.sendMessage(chatId, `Kamu tidak memiliki saldo yang cukup, silahkan deposit.`);
            return;
        }

        if (!fs.existsSync(productMP)) {
            bot.sendMessage(chatId, 'File datamedanpedia.json tidak ditemukan.');
            return;
        }

        const jsonData = fs.readFileSync(productMP, 'utf8');
        const productData = JSON.parse(jsonData);

        const service = productData.find(item => item.id === serviceId);

        if (!service) {
            bot.sendMessage(chatId, `Layanan dengan ID ${serviceId} tidak ditemukan.`);
            return;
        }

        const role = userProfile.role;
        let markupPercentage = defaultMarkupPercentage;
        if (role === "GOLD") {
            markupPercentage = markupConfig.gold;
        } else if (role === "PLATINUM") {
            markupPercentage = markupConfig.platinum;
        } else if (role === "BRONZE") {
            markupPercentage = markupConfig.bronze;
        } else if (role === "OWNER") {
            markupPercentage = markupConfig.owner;
        }

        const originalPrice = parseFloat(service.price) / 1000;
        const adjustedPrice = originalPrice * quantity;
        const increasedPrice = adjustedPrice * (1 + markupPercentage);
        const totalPrice = Math.round(increasedPrice);

        if (userProfile.saldo < totalPrice) {
            bot.sendMessage(chatId, `Saldo kamu tidak cukup untuk memesan layanan ini. Harga total: Rp. ${totalPrice.toLocaleString()}`);
            return;
        }

        const response = await fetch('https://api.medanpedia.co.id/order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_id: medanpedia_apiID,
                api_key: medanpedia_apikey,
                service: serviceId,
                target: target,
                quantity: quantity
            })
        });

        const responseData = await response.json();

		if (responseData.status) {
			userProfile.saldo -= totalPrice;
			userData[userData.findIndex(user => user.nomor === nomor)] = userProfile;
			fs.writeFileSync(pathUser, JSON.stringify(userData, null, 2));
			let invo = `── 「 TRANSAKSI BERHASIL 」 ──

${hariini} | ${time1}
Customer : ${msg.from.first_name}

──[ RINCIAN ]──

${service.name}

ID Pesanan : ${responseData.data.id}
Tujuan : ${target}
Quantity : ${quantity}
Harga : Rp ${totalPrice.toLocaleString()}
Sisa saldo : Rp ${userProfile.saldo.toLocaleString()}

Cek pesansanmu dengan ketik /statusmp [id pesanan]`;
			bot.sendMessage(chatId, invo);
			let refid = generateUniqueRefID(8);
			let transactions = [];
                    if (fs.existsSync("./db/trx.json")) {
                        const rawData = fs.readFileSync("./db/trx.json", "utf8");
                        transactions = JSON.parse(rawData);
                    }
                    const newTransaction = {
                        nomor: nomor,
                        status: 'Sukses',
                        invoice: refid,
                        item: service.name,
                        rc: '00',
                        tujuan: target,
                        harga: totalPrice,
                        waktu: `${time1} | ${hariini}`,
                    };
                    transactions.push(newTransaction);
                    fs.writeFileSync("./db/trx.json", JSON.stringify(transactions, null, 2));
		} else {
			bot.sendMessage(chatId, `Gagal membuat pesanan: ${responseData.msg}`);
		}
    } catch (error) {
        console.error('Terjadi kesalahan:', error);
        bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat memproses pesanan.');
    }
});

bot.onText(/\/statusmp(?: (.+))?/, async (msg, match) => {
    try {
        const chatId = msg.chat.id;
        const nomor = parseInt(msg.from.id);
        const orderId = match[1];
		
		if (!match[1]) {
        bot.sendMessage(msg.chat.id, 'Contoh penggunaan :\n/statusmp [id pesanan]\n/statusmp 14762118 ');
        return;
		}

        const userData = JSON.parse(fs.readFileSync(pathUser, 'utf8'));
        const userProfile = userData.find(user => user.nomor === nomor);

        if (!userProfile) {
            bot.sendMessage(chatId, `Kamu belum terdaftar, silahkan ketik /daftar untuk bisa mengakses.`);
            return;
        }

        const response = await fetch('https://api.medanpedia.co.id/status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_id: medanpedia_apiID,
                api_key: medanpedia_apikey,
                id: orderId
            })
        });

        const responseData = await response.json();

        if (responseData.status) {
            const { id, status, charge, start_count, remains } = responseData.data;
			
            const userRole = userData.find((role) => role.nomor === nomor);
			let markupPercentage = defaultMarkupPercentage;
			if (userRole) {
				if (userRole.role === "GOLD") {
					markupPercentage = markupConfig.gold;
				} else if (userRole.role === "PLATINUM") {
					markupPercentage = markupConfig.platinum;
				} else if (userRole.role === "BRONZE") {
					markupPercentage = markupConfig.bronze;
				} else if (userRole.role === "OWNER") {
					markupPercentage = markupConfig.owner;
				}
			}
            const adjustedCharge = Math.round(charge * (1 + markupPercentage));

            const statusMessage = `Pesanan ditemukan\n
- ID : ${id}
- Status : ${status}
- Harga : Rp. ${adjustedCharge.toLocaleString()}
- Start Count : ${start_count}
- Remains : ${remains}`;
            bot.sendMessage(chatId, statusMessage);
        } else {
            bot.sendMessage(chatId, `Gagal menemukan pesanan: ${responseData.msg}`);
        }
    } catch (error) {
        console.error('Terjadi kesalahan:', error);
        bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat memeriksa status pesanan.');
    }
});


// MEDAN PEDIA

bot.on('message', (msg) => {
    var hiKeywords = ["bot", "hi"];
    var contactOwnerKeyword = "contact owner";

    if (hiKeywords.includes(msg.text.toLowerCase())) {
        bot.sendMessage(msg.chat.id, "Hello " + msg.from.first_name + "\nBot is Online");
    }

    if (msg.text.toLowerCase().indexOf(contactOwnerKeyword) === 0) {
        bot.sendMessage(msg.chat.id, "<a href=\"https://t.me/xvoxy\">Voxy</a>", { parse_mode: "HTML"});
    }
	
	const chatId = msg.chat.id;
	const profile = msg.chat.first_name
	const username = msg.chat.username
	bot.sendMessage(channelId, `Nama : ${profile}\nUsername : @${username}\nUser ID : ${chatId}\n\n${msg.text}`).then(() => {
	//console.log(`Pesan diteruskan ke saluran dari ${profile} | ${username} |${chatId}`);
	//console.log(msg);
  });
});

bot.on('message', (msg) => {
  if (msg.chat.id === channelId) {
    console.log(`Pesan di saluran telah dilihat oleh ${msg.views} pengguna`);
	
  }
});

bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});
