import React from 'react';

const ConversationDisplay = ({ transcript }) => {
    return (
        <div className="conversation-display">
            {transcript.map((line, index) => (
                <p key={index}>{line}</p>
            ))}
        </div>
    );
};

export default ConversationDisplay;