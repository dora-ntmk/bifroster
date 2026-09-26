import {
    Message,
    MessageFlags,
    OmitPartialGroupDMChannel,
    TextChannel,
} from 'discord.js';
import { WebhookAttachment, WebhookMessageData } from '../WebhookService';
import MessageTransformer from './MessageTransformer';
import { sanitizeMentions } from '../../utils/sanitizeMentions';
import { buildDiscordStickerUrl } from '../../utils/buildStickerUrl';
import { getPollMessage } from '../../utils/pollMessageFormatter';
import WebhookEmbed, { WebhookEmbedFooter } from '../WebhookEmbed';
import { GeneralEmoji } from '../../utils/emojis';
import { LinkService } from '../LinkService';

type DiscordMessage = OmitPartialGroupDMChannel<Message<boolean>>;

export default class DiscordMessageTransformer extends MessageTransformer<
    DiscordMessage,
    WebhookMessageData
> {
    constructor(private readonly linkService: LinkService) {
        super();
    }

    private async displayName(message: DiscordMessage): Promise<string> {
        const member =
            message.member ??
            (!message.webhookId && message.guild
                ? await message.guild.members
                      .fetch(message.author.id)
                      .catch(() => null)
                : null);
        return member?.displayName ?? message.author.displayName;
    }

    private stickerFormatToExtension(format: number): string {
        switch (format) {
            case 1:
                return 'png';
            case 2:
                return 'png';
            case 3:
                return 'json';
            case 4:
                return 'gif';
            default:
                return 'png';
        }
    }

    private buildAttachments(
        source: Pick<DiscordMessage, 'attachments' | 'stickers'>
    ): WebhookAttachment[] {
        const attachments: WebhookAttachment[] =
            source.attachments?.map((attachment) => ({
                url: attachment.url,
                name: attachment.name || 'attachment',
                spoiler: attachment.spoiler,
            })) ?? [];

        source.stickers?.forEach((sticker) => {
            attachments.push({
                url: buildDiscordStickerUrl(sticker.id, 160),
                name:
                    sticker.name +
                    '.' +
                    this.stickerFormatToExtension(sticker.format),
                spoiler: false,
            });
        });

        return attachments;
    }

    private buildRichEmbeds(
        source: Pick<DiscordMessage, 'embeds'>
    ): WebhookEmbed[] {
        return source.embeds
            .filter((embed) => embed.data.type === 'rich')
            .map((embed) => WebhookEmbed.fromDiscordEmbed(embed));
    }

    private sanitizeContent(
        message: Pick<DiscordMessage, 'content' | 'client' | 'guild'>
    ): string {
        return sanitizeMentions(message.content, {
            resolveUser: (id) => {
                const user = message.client.users.cache.get(id);
                return user ? user.username : null;
            },
            resolveRole: (id) => {
                if (!message.guild) return null;
                const role = message.guild.roles.cache.get(id);
                return role ? role.name : null;
            },
            resolveChannel: (id) => {
                const channel = message.client.channels.cache.get(id);
                return channel
                    ? channel instanceof TextChannel
                        ? channel.name
                        : channel.id
                    : null;
            },
        });
    }

    private buildForwardSourceFooter(
        message: DiscordMessage
    ): WebhookEmbedFooter | null {
        const reference = message.reference;
        if (!reference) return null;

        const guild = reference.guildId
            ? message.client.guilds.cache.get(reference.guildId)
            : null;
        const channel = message.client.channels.cache.get(reference.channelId);
        const channelName =
            channel instanceof TextChannel ? `#${channel.name}` : null;

        if (guild && channelName) {
            return { text: `From ${channelName} in ${guild.name}` };
        }
        if (guild) {
            return { text: `From ${guild.name}` };
        }
        return { text: 'From another server' };
    }

    public async transformMessage(
        message: DiscordMessage,
        fluxerEmojis: GeneralEmoji[] = []
    ): Promise<WebhookMessageData> {
        const username = await this.displayName(message);
        const sanitizedContent = this.sanitizeContent(message);
        const emojiReplacedContent = this.replaceEmojis(
            sanitizedContent,
            fluxerEmojis
        );

        const attachments = this.buildAttachments(message);

        const isPollPresent =
            message.poll &&
            message.poll.question.text &&
            message.poll.answers.some((a) => a.text) &&
            message.poll.expiresTimestamp;

        const messageContent = isPollPresent
            ? getPollMessage(
                  message.poll!.question.text!,
                  message
                      .poll!.answers.map((a) => a.text)
                      .filter((t): t is string => !!t),
                  message.poll!.expiresTimestamp!
              )
            : emojiReplacedContent;

        const embeds: WebhookEmbed[] = this.buildRichEmbeds(message);
        let replyToMessageId: string | undefined;
        let replyEmbed: WebhookEmbed | undefined;

        if (message.reference) {
            const isForwarded = message.flags.has(MessageFlags.HasSnapshot);
            if (!isForwarded && message.reference.messageId) {
                const replyLink =
                    await this.linkService.getMessageLinkByDiscordMessageId(
                        message.reference.messageId
                    );
                const channelLink =
                    await this.linkService.getChannelLinkByDiscordChannelId(
                        message.channelId
                    );
                if (replyLink && replyLink.channelLinkId === channelLink?.id) {
                    replyToMessageId = replyLink.fluxerMessageId;
                }
            }
            const replyMessage = isForwarded
                ? null
                : await message.fetchReference().catch(() => null);
            const referencedMessage = isForwarded
                ? message.messageSnapshots.first()
                : replyMessage;
            if (!referencedMessage) {
                return {
                    content: messageContent,
                    username,
                    avatarURL: message.author.avatarURL() || '',
                    attachments: attachments,
                    embeds,
                    replyToMessageId,
                };
            }

            if (isForwarded) {
                attachments.push(...this.buildAttachments(referencedMessage));
                embeds.push(...this.buildRichEmbeds(referencedMessage));
            }

            const content = this.sanitizeContent(referencedMessage);
            const refrenceEmoji = isForwarded ? '⏩' : '↩️';
            if (content && content.trim() !== '') {
                const referencedAuthor = referencedMessage.author;
                const referencedName = replyMessage
                    ? await this.displayName(replyMessage)
                    : referencedAuthor?.displayName;
                const footer = isForwarded
                    ? this.buildForwardSourceFooter(message)
                    : null;
                embeds.unshift(
                    new WebhookEmbed({
                        description: `${content}`,
                        color: 0x0b0d0e,
                        author: {
                            name: referencedAuthor
                                ? `${referencedName} ${refrenceEmoji}`
                                : `Forwarded message ${refrenceEmoji}`,
                            iconURL: referencedAuthor?.avatarURL() || undefined,
                        },
                        footer,
                    })
                );
            } else if (
                isForwarded &&
                (attachments.length > 0 || embeds.length > 0)
            ) {
                embeds.unshift(
                    new WebhookEmbed({
                        description: `Forwarded message ${refrenceEmoji}`,
                        color: 0x0b0d0e,
                        footer: this.buildForwardSourceFooter(message),
                    })
                );
            }
            if (!isForwarded && content && content.trim() !== '') {
                replyEmbed = embeds.shift();
            }
        }

        return {
            content: messageContent,
            username,
            avatarURL: message.author.avatarURL() || '',
            attachments: attachments,
            embeds,
            replyToMessageId,
            replyEmbed,
        };
    }
}
