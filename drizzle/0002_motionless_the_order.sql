CREATE TABLE `memory_vectors` (
	`id` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`avatarId` int NOT NULL,
	`type` enum('conversation_summary','user_preference','emotional_pattern','key_fact','personality_trait') NOT NULL,
	`content` text NOT NULL,
	`embedding` json NOT NULL,
	`metadata` json,
	`importance` float NOT NULL DEFAULT 0.5,
	`accessCount` int NOT NULL DEFAULT 0,
	`lastAccessedAt` bigint NOT NULL,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `memory_vectors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `model_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cacheKey` varchar(128) NOT NULL,
	`userId` int NOT NULL,
	`avatarId` int,
	`cacheType` enum('smplx_fit','clothing_render','final_render') NOT NULL,
	`modelUrl` text NOT NULL,
	`modelKey` varchar(512) NOT NULL,
	`paramsHash` varchar(64) NOT NULL,
	`paramsSnapshot` json,
	`fileSize` bigint,
	`hitCount` int NOT NULL DEFAULT 0,
	`lastHitAt` timestamp,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `model_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `model_cache_cacheKey_unique` UNIQUE(`cacheKey`)
);
