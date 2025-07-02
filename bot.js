const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const http = require('http');

// Bot configuration
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ]
});

// Configuration - Edit these values
const CONFIG = {
    TOKEN: process.env.DISCORD_TOKEN, // Now uses environment variable
    CAM_ONLY_CHANNELS: ['1388844658184032256', '1388844741306744974', '1388844848198582362', '1388844911520120843', '1388844944420241470'],
    GRACE_PERIOD: 10000, // Time in milliseconds to turn on camera (10 seconds)
    WARNING_MESSAGE: {
        title: '📹 Camera Required!',
        description: 'This voice channel requires you to have your camera turned on.',
        color: 0xFF6B6B,
        footer: 'Turn on your camera and rejoin the channel.'
    }
};

// Store users who are in grace period
const graceUsers = new Map();

// Function to check if user is exempt (admin/moderator)
function isExemptUser(member) {
    // Check if user has Administrator permission
    if (member.permissions.has('Administrator')) {
        return true;
    }
    
    // Check if user has Manage Server permission (usually moderators)
    if (member.permissions.has('ManageGuild')) {
        return true;
    }
    
    // Check if user has specific roles (you can customize this)
    const exemptRoles = ['ADMIN', 'Staff', 'Owner']; // Add your admin role names here
    const hasExemptRole = member.roles.cache.some(role => 
        exemptRoles.includes(role.name)
    );
    
    return hasExemptRole;
}

client.once('ready', () => {
    console.log(`✅ Bot is ready! Logged in as ${client.user.tag}`);
    console.log(`🔍 Monitoring ${CONFIG.CAM_ONLY_CHANNELS.length} camera-only channels`);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        // User joined a voice channel
        if (!oldState.channelId && newState.channelId) {
            await handleUserJoin(newState);
        }
        
        // User changed channels
        if (oldState.channelId !== newState.channelId && newState.channelId) {
            await handleUserJoin(newState);
        }
        
        // User turned camera on/off while in channel
        if (oldState.channelId === newState.channelId && newState.channelId) {
            await handleCameraChange(oldState, newState);
        }
        
        // User left channel - clear grace period
        if (oldState.channelId && !newState.channelId) {
            clearGracePeriod(newState.member.id);
        }
        
    } catch (error) {
        console.error('Error handling voice state update:', error);
    }
});

async function handleUserJoin(voiceState) {
    const { channelId, member } = voiceState;
    
    // Check if this is a camera-only channel
    if (!CONFIG.CAM_ONLY_CHANNELS.includes(channelId)) {
        return;
    }
    
    // Check if user is admin/moderator (exempt from camera requirement)
    if (isExemptUser(member)) {
        console.log(`👑 ${member.user.tag} joined camera-only channel (ADMIN - exempt from camera requirement)`);
        return;
    }
    
    // Check if user has camera on
    const hasCamera = voiceState.selfVideo;
    
    if (!hasCamera) {
        console.log(`👁️ ${member.user.tag} joined camera-only channel without camera`);
        
        // Start grace period
        startGracePeriod(member, channelId);
    } else {
        console.log(`✅ ${member.user.tag} joined camera-only channel with camera on`);
        // Clear any existing grace period
        clearGracePeriod(member.id);
    }
}

async function handleCameraChange(oldState, newState) {
    const { channelId, member } = newState;
    
    // Only check camera-only channels
    if (!CONFIG.CAM_ONLY_CHANNELS.includes(channelId)) {
        return;
    }
    
    // Check if user is admin/moderator (exempt from camera requirement)
    if (isExemptUser(member)) {
        return;
    }
    
    const hadCamera = oldState.selfVideo;
    const hasCamera = newState.selfVideo;
    
    // Camera turned off
    if (hadCamera && !hasCamera) {
        console.log(`📹 ${member.user.tag} turned off camera in camera-only channel`);
        startGracePeriod(member, channelId);
    }
    
    // Camera turned on
    if (!hadCamera && hasCamera) {
        console.log(`✅ ${member.user.tag} turned on camera`);
        clearGracePeriod(member.id);
    }
}

function startGracePeriod(member, channelId) {
    // Clear existing timeout if any
    clearGracePeriod(member.id);
    
    console.log(`⏰ Starting ${CONFIG.GRACE_PERIOD/1000}s grace period for ${member.user.tag}`);
    
    // Set timeout to disconnect user
    const timeout = setTimeout(async () => {
        try {
            await disconnectAndWarn(member, channelId);
        } catch (error) {
            console.error(`Error disconnecting ${member.user.tag}:`, error);
        } finally {
            graceUsers.delete(member.id);
        }
    }, CONFIG.GRACE_PERIOD);
    
    graceUsers.set(member.id, timeout);
}

function clearGracePeriod(userId) {
    const timeout = graceUsers.get(userId);
    if (timeout) {
        clearTimeout(timeout);
        graceUsers.delete(userId);
        console.log(`✅ Grace period cleared for user ${userId}`);
    }
}

async function disconnectAndWarn(member, channelId) {
    try {
        // Get channel name for the warning message
        const channel = member.guild.channels.cache.get(channelId);
        const channelName = channel ? channel.name : 'Camera-Only Voice Channel';
        
        // Disconnect user from voice channel
        await member.voice.disconnect('Camera not enabled in camera-only channel');
        
        // Send DM warning
        const embed = new EmbedBuilder()
            .setTitle(CONFIG.WARNING_MESSAGE.title)
            .setDescription(`${CONFIG.WARNING_MESSAGE.description}\n\n**Channel:** ${channelName}\n\nPlease turn on your camera and rejoin the channel.`)
            .setColor(CONFIG.WARNING_MESSAGE.color)
            .setFooter({ text: CONFIG.WARNING_MESSAGE.footer })
            .setTimestamp();
        
        await member.send({ embeds: [embed] });
        
        console.log(`🚫 Disconnected ${member.user.tag} from ${channelName} and sent warning DM`);
        
    } catch (error) {
        if (error.code === 50007) {
            console.log(`❌ Cannot send DM to ${member.user.tag} (DMs disabled)`);
        } else {
            console.error(`Error warning user ${member.user.tag}:`, error);
        }
    }
}

// Error handling
client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Create HTTP server to keep service alive on Render
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Discord Camera Bot is running!\n\nBot Status: ${client.user ? 'Online' : 'Offline'}\nMonitoring ${CONFIG.CAM_ONLY_CHANNELS.length} channels`);
});

server.listen(PORT, () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
});

// Start the bot
client.login(CONFIG.TOKEN).catch(error => {
    console.error('Failed to login:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down bot...');
    server.close();
    client.destroy();
    process.exit(0);
});

// Keep alive ping (optional - helps prevent sleeping)
setInterval(() => {
    console.log('🔄 Bot heartbeat - keeping service alive');
}, 300000); // Every 5 minutes
