import {
    Client as FluxerClient,
    TextChannel as FluxerTextChannel,
    Webhook as FluxerWebhook,
    MessageAttachmentFlags,
    Routes as FluxerRoutes,
} from '@fluxerjs/core';
import {
    AttachmentBuilder,
    Client as DiscordClient,
    TextChannel as DiscordTextChannel,
    WebhookClient,
} from 'discord.js';
import logger from '../utils/logging/logger';
import WebhookEmbed from './WebhookEmbed';

type DiscordWebhook = WebhookClient;

export type WebhookAttachment = {
    url: string;
    name: string;
    spoiler?: boolean;
};

export type WebhookMessageData = {
    content: string;
    username: string;
    avatarURL: string;
    attachments?: WebhookAttachment[];
    embeds?: WebhookEmbed[];
    replyToMessageId?: string;
    replyEmbed?: WebhookEmbed;
};

export class WebhookService {
    private discordClient: DiscordClient | null = null;
    private fluxerClient: FluxerClient | null = null;

    setDiscordClient(client: DiscordClient) {
        this.discordClient = client;
    }

    setFluxerClient(client: FluxerClient) {
        this.fluxerClient = client;
    }

    async createDiscordWebhook(
        channelId: string,
        name: string
    ): Promise<{ id: string; token: string }> {
        if (!this.discordClient) {
            throw new Error('Discord client not set in WebhookService');
        }

        try {
            const channel = await this.discordClient.channels.fetch(channelId);
            if (!channel || !(channel instanceof DiscordTextChannel)) {
                throw new Error('Invalid Discord channel');
            }

            const webhook = await channel.createWebhook({ name });
            return { id: webhook.id, token: webhook.token! };
        } catch (error: unknown) {
            logger.error('Error creating Discord webhook:', error);
            throw error;
        }
    }

    async getDiscordWebhook(
        webhookId: string,
        webhookToken: string
    ): Promise<DiscordWebhook | null> {
        if (!this.discordClient) {
            throw new Error('Discord client not set in WebhookService');
        }

        try {
            const webhook = await this.discordClient.fetchWebhook(
                webhookId,
                webhookToken
            );
            if (!webhook) return null;
            const webhookClient = new WebhookClient({
                id: webhookId,
                token: webhookToken,
            });
            return webhookClient;
        } catch (error: unknown) {
            logger.error('Error getting or creating Discord webhook:', error);
            throw error;
        }
    }

    async sendMessageViaDiscordWebhook(
        webhook: DiscordWebhook,
        data: WebhookMessageData
    ): Promise<{ messageId: string }> {
        try {
            const files = data.attachments?.map((att) => {
                const attBuilder = new AttachmentBuilder(att.url, {
                    name: att.name,
                });
                if (att.spoiler) attBuilder.setSpoiler(true);
                return attBuilder;
            });

            const { id } = await webhook.send({
                content: data.content,
                username: data.username,
                avatarURL: data.avatarURL,
                files,
                embeds:
                    data.embeds?.map((embed) => embed.toDiscordEmbed()) || [],
            });

            return { messageId: id };
        } catch (error: unknown) {
            logger.error('Error sending message via Discord webhook:', error);
            throw error;
        }
    }

    async editMessageViaDiscordWebhook(
        webhook: DiscordWebhook,
        messageId: string,
        data: WebhookMessageData
    ): Promise<void> {
        try {
            const files = data.attachments?.map((att) => {
                const attBuilder = new AttachmentBuilder(att.url, {
                    name: att.name,
                });
                if (att.spoiler) attBuilder.setSpoiler(true);
                return attBuilder;
            });

            await webhook.editMessage(messageId, {
                content: data.content,
                files,
                embeds:
                    data.embeds?.map((embed) => embed.toDiscordEmbed()) || [],
            });
        } catch (error: unknown) {
            logger.error('Error editing message via Discord webhook:', error);
            throw error;
        }
    }

    async createFluxerWebhook(
        channelId: string,
        name: string
    ): Promise<{ id: string; token: string }> {
        if (!this.fluxerClient) {
            throw new Error('Fluxer client not set in WebhookService');
        }

        try {
            const channel = (await this.fluxerClient.channels.fetch(
                channelId
            )) as FluxerTextChannel;
            const webhook = await channel.createWebhook({ name });
            return { id: webhook.id, token: webhook.token! };
        } catch (error: unknown) {
            logger.error('Error creating Fluxer webhook:', error);
            throw error;
        }
    }

    async deleteDiscordWebhook(
        webhookId: string,
        webhookToken: string
    ): Promise<void> {
        if (!this.discordClient) return;
        try {
            const webhook = await this.discordClient.fetchWebhook(
                webhookId,
                webhookToken
            );
            await webhook.delete();
        } catch (error) {
            logger.error('Error deleting Discord webhook:', error);
            throw error;
        }
    }

    async deleteFluxerWebhook(
        webhookId: string,
        webhookToken: string
    ): Promise<void> {
        if (!this.fluxerClient) return;
        try {
            const webhook = FluxerWebhook.fromToken(
                this.fluxerClient,
                webhookId,
                webhookToken
            );
            await webhook.delete();
        } catch (error) {
            logger.error('Error deleting Fluxer webhook:', error);
            throw error;
        }
    }

    async getFluxerWebhook(
        webhookId: string,
        webhookToken: string
    ): Promise<FluxerWebhook> {
        if (!this.fluxerClient) {
            throw new Error('Fluxer client not set in WebhookService');
        }

        try {
            const webhook = FluxerWebhook.fromToken(
                this.fluxerClient,
                webhookId,
                webhookToken
            );
            return webhook;
        } catch (error: unknown) {
            logger.error('Error getting or creating Fluxer webhook:', error);
            throw error;
        }
    }

    async sendMessageViaFluxerWebhook(
        webhook: FluxerWebhook,
        data: WebhookMessageData
    ): Promise<{ messageId: string }> {
        try {
            const options = {
                replyTo: data.replyToMessageId
                    ? { messageId: data.replyToMessageId }
                    : undefined,
                allowedMentions: { parse: [], repliedUser: false },
                ping: false,
            };
            const msg = await webhook.send(
                {
                    ...options,
                    content: data.content,
                    username: data.username,
                    avatarUrl: data.avatarURL,
                    files:
                        data.attachments?.map((attachment) => ({
                            url: attachment.url,
                            name: attachment.name,
                            filename: attachment.name,
                        })) || [],
                    attachments:
                        data.attachments?.map((attachment, index) => ({
                            id: index,
                            name: attachment.name,
                            filename: attachment.name,
                            flags: attachment.spoiler
                                ? MessageAttachmentFlags.IS_SPOILER
                                : undefined,
                        })) || [],
                    embeds: [
                        ...(!data.replyToMessageId && data.replyEmbed
                            ? [data.replyEmbed]
                            : []),
                        ...(data.embeds || []),
                    ].map((embed) => embed.toFluxerEmbed()),
                },
                true
            );

            if (!msg) {
                throw new Error(
                    'Did not receive message object after sending via Fluxer webhook'
                );
            }

            return { messageId: msg.id };
        } catch (error: unknown) {
            // The target may have been deleted after the mapping was saved.
            // Retry only a rejected reference, never an ambiguous send failure.
            if (
                data.replyToMessageId &&
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                error.code === 'UNKNOWN_MESSAGE'
            ) {
                return this.sendMessageViaFluxerWebhook(webhook, {
                    ...data,
                    replyToMessageId: undefined,
                });
            }
            logger.error('Error sending message via Fluxer webhook:', error);
            throw error;
        }
    }

    async editMessageViaFluxerWebhook(
        webhook: FluxerWebhook,
        messageId: string,
        data: WebhookMessageData
    ): Promise<void> {
        try {
            // References cannot be changed on edit. Preserve the original
            // representation even if the reply mapping has changed since send.
            const original =
                data.replyEmbed || data.replyToMessageId
                    ? await webhook.fetchMessage(messageId)
                    : null;
            const route =
                FluxerRoutes.webhookExecute(webhook.id, webhook.token!) +
                `/messages/${messageId}`;
            await webhook.client.rest.patch(route, {
                body: {
                    content: data.content,
                    allowed_mentions: { parse: [], replied_user: false },
                    attachments:
                        data.attachments?.map((attachment, index) => ({
                            id: index,
                            name: attachment.name,
                            filename: attachment.name,
                            flags: attachment.spoiler
                                ? MessageAttachmentFlags.IS_SPOILER
                                : undefined,
                        })) || [],
                    embeds: [
                        ...(!original?.messageReference && data.replyEmbed
                            ? [data.replyEmbed]
                            : []),
                        ...(data.embeds || []),
                    ].map((embed) => embed.toFluxerEmbed()),
                },
                auth: false,
            });
        } catch (error: unknown) {
            logger.error('Error editing message via Fluxer webhook:', error);
            throw error;
        }
    }
}
