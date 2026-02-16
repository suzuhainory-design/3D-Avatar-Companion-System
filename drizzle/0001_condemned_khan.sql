CREATE TABLE `avatarStepHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`avatarId` int NOT NULL,
	`stepName` varchar(32) NOT NULL,
	`paramsSnapshot` json NOT NULL,
	`stepOrder` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `avatarStepHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `avatars` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL DEFAULT '我的数字人',
	`status` enum('draft','customizing','rendering','completed') NOT NULL DEFAULT 'draft',
	`currentStep` varchar(32) NOT NULL DEFAULT 'upload',
	`sourceImageUrl` text,
	`segmentedImageUrl` text,
	`gender` enum('male','female') NOT NULL DEFAULT 'female',
	`skeletonParams` json,
	`skinParams` json,
	`facialParams` json,
	`genderFeatureParams` json,
	`makeupParams` json,
	`hairParams` json,
	`clothingId` int,
	`finalHeight` float,
	`modelFileUrl` text,
	`modelFileKey` varchar(512),
	`smplxParams` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `avatars_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chatMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`role` enum('user','assistant','system') NOT NULL,
	`content` text NOT NULL,
	`attachments` json,
	`emotionAnalysis` json,
	`wasInterrupted` int NOT NULL DEFAULT 0,
	`interruptedAtContent` text,
	`ttsAudioUrl` text,
	`embeddingId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chatMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chatSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`avatarId` int NOT NULL,
	`title` varchar(255) NOT NULL DEFAULT '新对话',
	`status` enum('active','archived') NOT NULL DEFAULT 'active',
	`summary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chatSessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clothingItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`name` varchar(255) NOT NULL,
	`category` enum('top','bottom','dress','outerwear','shoes','accessory') NOT NULL,
	`isDefault` int NOT NULL DEFAULT 0,
	`thumbnailUrl` text,
	`sourceImageUrl` text,
	`modelFileUrl` text,
	`modelFileKey` varchar(512),
	`defaultColor` json,
	`customColor` json,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `clothingItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `uploadedFiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`originalName` varchar(512) NOT NULL,
	`mimeType` varchar(128) NOT NULL,
	`fileSize` bigint NOT NULL,
	`url` text NOT NULL,
	`fileKey` varchar(512) NOT NULL,
	`purpose` enum('avatar_source','clothing_source','chat_attachment','model_output') NOT NULL,
	`relatedId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `uploadedFiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userPreferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`category` varchar(64) NOT NULL,
	`prefKey` varchar(128) NOT NULL,
	`prefValue` text NOT NULL,
	`embeddingId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userPreferences_id` PRIMARY KEY(`id`)
);
