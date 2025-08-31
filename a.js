const saveDesign = async (designData) => {
    const response = await fetch('http://localhost:3001/api/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(designData)
    });
    console.log(response)
    return await response.json();

};

saveDesign()