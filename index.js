const noblox = require('noblox.js');
const { REST, Routes } = require('zoblox.js');
const mail = require('./google.js');

class PayoutRequestBody {
    static create(userId, amount) {
        return {
            PayoutType: "FixedAmount",
            Recipients: [
                {
                    "recipientId": userId,
                    "recipientType": "User",
                    "amount": amount
                }
            ]
        };
    }
}

/** @type {import('zoblox.js').REST} */
let restInstance = null;

class Rest {
    static get instance() {
        if (!restInstance) {
            restInstance = new REST();
        }
        return restInstance;
    }
    static async setCookie() {
        await restInstance.setCookie(require('./config.json')[0])
    }
}

class AsyncPayoutManager {
    static get Rest() {
        const rest = Rest.instance;
        return rest;
    }

    /**
     * 
     * @param {'Generic_TwoStepVerification_Initialized' | 'Generic_TwoStepVerification_Initialized_unknown'} name 
     * @returns {Promise<{}>}
     */
    static async Report(name) {
        return await AsyncPayoutManager.Rest.post(`https://assetgame.roblox.com/game/report-event?name=${name}`);
    }

    /**
     * @param {'event_2sv' | 'event_generic'} name 
     * @returns {Promise<{}>}
     */
    static async Record(name) {
        return await AsyncPayoutManager.Rest.post('https://apis.roblox.com/account-security-service/v1/metrics/record', {
            data: name === 'event_2sv' ? {
                "name": "event_2sv",
                "value": 1,
                "labelValues": {
                    "action_type": "Generic",
                    "event_type": "Initialized",
                    "application_type": "unknown"
                }
            } : {
                "name": "event_generic",
                "value": 1,
                "labelValues": {
                    "event_type": "Success",
                    "challenge_type": "twostepverification"
                }
            }
        });
    }

    /**
     * 
     * @param {number} userId 
     * @param {number} ChallengeId 
     * @returns {Promise<{}>}
     */
    static async ChallengeMetaData(userId, ChallengeId) {
        return await AsyncPayoutManager.Rest.get(`https://twostepverification.roblox.com/v1/metadata?userId=${userId}&challengeId=${ChallengeId}&actionType=Generic`);
    }

    static async ChallangeConfiguration(userId, ChallengeId) {
        return new Promise((ProcessingInvokeingFunc, PromiseRejectionFunc) => {
            AsyncPayoutManager.Rest.get(`https://twostepverification.roblox.com/v1/users/${userId}/configuration?challengeId=${ChallengeId}&actionType=Generic`).then(({ data }) => {
                ProcessingInvokeingFunc(data.primaryMediaType.toLowerCase())
            }).catch(PromiseRejectionFunc)
        })
    }
    /**
     * 
     * @param {number} groupId 
     * @param {number} userId 
     * @returns {boolean}
     */
    static async UserPayoutEligibilit(groupId, userId) {
        const { data } = await AsyncPayoutManager.Rest.get(`https://economy.roblox.com/v1/groups/${groupId}/users-payout-eligibility?userIds=${userId}`).catch(e => {
            return { data: { usersGroupPayoutEligibility: null } }
        });
        return data.usersGroupPayoutEligibility?.[userId.toString()] ? true : false
    }

    /**
     * 
     * @param {number | string} userId 
     * @param {string} ChallengeId 
     * @param {number | string} verificationCode 
     * @param {'email' | 'authenticator' | 'sms' | 'security-key'} type 
     * @returns {Promise<{}>}
     */
    static async PayoutVerify(userId, ChallengeId, verificationCode, type = "email") {
        return new Promise((ProcessingInvokeingFunc, PromiseRejectionFunc) => {
            AsyncPayoutManager.Rest.post(`https://twostepverification.roblox.com/v1/users/${userId}/challenges/${type}/verify`, {
                data: {
                    ChallengeId,
                    actionType: 'Generic',
                    code: verificationCode,
                }
            }).catch(({ response }) => {
                const errors = response.data.errors;
                if (errors.find(e => e.code === 1)) PromiseRejectionFunc(new Error('Invalid challenge ID.'));
                if (errors.find(e => e.code === 5)) PromiseRejectionFunc(new Error('Too many requests.'));
                if (errors.find(e => e.code === 9)) PromiseRejectionFunc(new Error('The two step verification configuration is invalid for this action.'));
                if (errors.find(e => e.code === 10)) PromiseRejectionFunc(new Error('The two step verification challenge code is invalid.'));
                else PromiseRejectionFunc(new Error('(Unkown Error Code) Two step verification is currently under maintenance'));
            }).then(ProcessingInvokeingFunc)
        })
    }
}

/**
 * 
 * @param {number} T 
 * @returns {Promise<void>}
 */
const wait = (T) => new Promise((res) => setTimeout(res, T));


async function Main() {
    const User = await noblox.setCookie(require('./config.json')[0]);
    console.log(`${User.UserName} is ready`);
    Rest.instance;
    await Rest.setCookie();
    await Payout('8059703', 'YG_TOPR', 1)
}
/**
 * 
 * @param {number | string} groupId 
 * @param {string} username 
 * @param {number} amount 
 * @returns {Promise<void>}
 */
async function Payout(groupId, username, amount) {
    const userId = await noblox.getIdFromUsername(username);
    const isUserEligibilit = await AsyncPayoutManager.UserPayoutEligibilit(groupId, userId);

    if (!isUserEligibilit) return new Error("bla bla");

    const requestBody = PayoutRequestBody.create(userId, amount);

    const instance = Rest.instance;
    await Rest.setCookie();

    await instance.post(Routes.groups.payouts(groupId), {
        data: requestBody
    }).then((data) => {
        console.log(data)
    }).catch(async e => {
        const rblxChallengeMetadata = e.response.headers['rblx-challenge-metadata'];

        const buffer = Buffer.from(rblxChallengeMetadata, 'base64');
        const data = JSON.parse(buffer.toString('utf-8'));

        await PayoutVerify(data.challengeId, username);

        await Payout(groupId, username, amount);
    });

}

async function PayoutVerify(ChallengeId, username, groupId) {
    const userId = await noblox.getIdFromUsername(username);

    await AsyncPayoutManager.ChallengeMetaData(userId, ChallengeId);
    await AsyncPayoutManager.Report('Generic_TwoStepVerification_Initialized_unknown');
    await AsyncPayoutManager.Report('Generic_TwoStepVerification_Initialized');
    await AsyncPayoutManager.Record('event_2sv');
    await AsyncPayoutManager.Record('event_generic');
    const type = await AsyncPayoutManager.ChallangeConfiguration(userId, ChallengeId);

    /** @type {number | null} */
    let verificationCode = null;
    let attempts = 0;

    while (!verificationCode && attempts < 60) { // Try for up to 60 seconds (1 minute)
        await wait(1000);
        const { message, done } = await mail();

        if (message.includes(username)) {
            const codeRegExp = /\b(\d{6})\b/;
            const match = message.match(codeRegExp);
            if (match && match[1]) {
                verificationCode = match[1];
                console.log('Found verification code:', verificationCode);
            } else {
                console.log('Unable to extract the verification code from the message:', message);
            }
        } else {
            console.log('Message does not contain the 2-Step Verification Code or does not include the username.');
        }
        attempts++;
        await wait(1000);
    }

    if (verificationCode) {
        console.log('Proceeding with the verification process using the obtained code...');
        await AsyncPayoutManager.PayoutVerify(userId, ChallengeId, verificationCode, type);

    } else if (!verificationCode) {
        console.log('Unable to retrieve the verification code automatically. Please complete the 2-Step Verification process manually.');
    }

}

Main();