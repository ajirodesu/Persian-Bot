export type PlatformCredentials = {
    platform: 'discord';
    discordToken: string;
    discordClientId: string;
} | {
    platform: 'telegram';
    telegramToken: string;
};
export interface CreateBotRequestDto {
    botNickname: string;
    botPrefix: string;
    botAdmins: string[];
    botPremiums?: string[];
    credentials: PlatformCredentials;
}
export interface CreateBotResponseDto {
    sessionId: string;
    userId: string;
    platformId: number;
    nickname: string;
    prefix: string;
}
export interface GetBotListItemDto {
    sessionId: string;
    platformId: number;
    platform: string;
    nickname: string;
    prefix: string;
}
export interface GetBotListResponseDto {
    bots: GetBotListItemDto[];
}
export interface GetBotDetailResponseDto {
    sessionId: string;
    userId: string;
    platformId: number;
    platform: string;
    nickname: string;
    prefix: string;
    admins: string[];
    premiums: string[];
    credentials: PlatformCredentials;
}
export type UpdateBotRequestDto = CreateBotRequestDto;
//# sourceMappingURL=bot.dto.d.ts.map