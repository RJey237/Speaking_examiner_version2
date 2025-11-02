import React from 'react';

const Controls = ({ isConnected, connect, disconnect }) => {
    return (
        <div className="controls">
            {!isConnected ? (
                <button onClick={connect}>Start Test</button>
            ) : (
                <button onClick={disconnect}>End Test</button>
            )}
        </div>
    );
};

export default Controls;