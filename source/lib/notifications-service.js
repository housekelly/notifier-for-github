import OptionsSync from 'webext-options-sync';
import {makeApiRequest, getNotifications, getTabUrl} from './api';
import {getNotificationReasonText} from './defaults';
import {openTab} from './tabs-service';
import localStore from './local-store';

const syncStore = new OptionsSync();

function getLastReadForNotification(notification) {
	// Extract the specific fragment URL for a notification
	// This allows you to directly jump to a specif comment as if you were using
	// the notifications page
	const lastReadTime = notification.last_read_at;
	const lastRead = new Date(lastReadTime || notification.updated_at);

	if (lastReadTime) {
		lastRead.setSeconds(lastRead.getSeconds() + 1);
	}

	return lastRead.toISOString();
}

async function issueOrPRHandler(notification) {
	const notificationUrl = notification.subject.url;

	try {
		const {pathname} = new URL(notificationUrl);
		const lastRead = getLastReadForNotification(notification);

		try {
			// Try to get the latest comment that the user has not read
			const {json: comments} = await makeApiRequest(pathname + '/comments', {
				since: lastRead,
				per_page: 1 // eslint-disable-line camelcase
			});

			const comment = comments[0];
			if (comment) {
				return comment.html_url;
			}

			// If there are not comments or events, then just open the url
			const {json: response} = await makeApiRequest(pathname);
			const targetUrl = response.message === 'Not Found' ? await getTabUrl() : response.html_url;
			return targetUrl;
		} catch (error) {
			return notificationUrl;
		}
	} catch (error) {
		throw error;
	}
}

const notificationHandlers = {
	/* eslint-disable quote-props */
	'Issue': issueOrPRHandler,
	'PullRequest': issueOrPRHandler,
	'RepositoryInvitation': notification => {
		return `${notification.repository.html_url}/invitations`;
	}
	/* eslint-enable quote-props */
};

export async function closeNotification(notificationId) {
	return browser.notifications.clear(notificationId);
}

export async function openNotification(notificationId) {
	const notification = await localStore.get(notificationId);
	await closeNotification(notificationId);
	await removeNotification(notificationId);

	try {
		const urlToOpen = await notificationHandlers[notification.subject.type](notification);
		return openTab(urlToOpen);
	} catch (error) {
		return openTab(await getTabUrl());
	}
}

export async function removeNotification(notificationId) {
	return localStore.remove(notificationId);
}

export function getNotificationObject(notificationInfo) {
	return {
		title: notificationInfo.subject.title,
		iconUrl: 'icon-notif.png',
		type: 'basic',
		message: notificationInfo.repository.full_name,
		contextMessage: getNotificationReasonText(notificationInfo.reason)
	};
}

export async function showNotifications(notifications) {
	for (const notification of notifications) {
		const notificationId = `github-notifier-${notification.id}`;
		const notificationObject = getNotificationObject(notification);

		browser.notifications.create(notificationId, notificationObject);

		localStore.set(notificationId, notification);
	}
}

export async function playNotificationSound() {
	const audio = new Audio();
	audio.src = await browser.extension.getURL('/sounds/bell.ogg');
	audio.play();
}

export async function checkNotifications(lastModified) {
	const notifications = await getNotifications({lastModified});
	const {showDesktopNotif, playNotifSound} = await syncStore.getAll();

	if (playNotifSound && notifications.length > 1) {
		await playNotificationSound();
	}

	if (showDesktopNotif) {
		await showNotifications(notifications);
	}
}