import React from 'react';

const Results = ({ transcript, feedback }) => {
    return (
        <div className="results">
            <h3>Test Results</h3>
            <h4>Transcript</h4>
            <div className="transcript">
                {transcript.map((line, index) => (
                    <p key={index}>{line}</p>
                ))}
            </div>
            <h4>Feedback</h4>
            <p>{feedback}</p>
        </div>
    );
};

export default Results;