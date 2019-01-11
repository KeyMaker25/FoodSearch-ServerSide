const express = require('express')
const bodyParser = require('body-parser')
const { Pool } = require('pg')
const fetch = require('node-fetch')
const request = require('request')
var casting = require('casting')


const port = process.env.PORT || 3000
const pool = new Pool({
    //postgres://uhcdqgqaoahhpz:097bc9320efff68f261c24d2b2d302e43b715f748b6a1846b32d4c6c1ec9cef8@ec2-174-129-41-12.compute-1.amazonaws.com:5432/d1640ih38s8snf"
    connectionString: process.env.DATABASE_URL,
    ssl: true
})

let app = express()
app.use(bodyParser.urlencoded({
    extended: true
}));
//needed for parsing Json
app.use(bodyParser.json());

//to show the ingredients table
app.get('/ingredients', function (req, res) {
    const sql = `SELECT * FROM ingredients`
    const args = []
    pool.query(sql, args, (err, dbRes) => {
        if (dbRes) {
            res.json(dbRes.rows)
        } else if (err) {
            res.json(err)
        }
    })
})

//show recipes table
app.get('/recipes', function (req, res) {
    const sql = `SELECT * FROM recipes`
    const args = []
    pool.query(sql, args, (err, dbRes) => {
        if (dbRes) {
            res.json(dbRes.rows)
        } else if (err) {
            res.json(err)
        }
    })
})
//show third list of ingredient for recipe
app.get('/recipeingredients', function (req, res) {
    const sql = `SELECT * FROM recipeingredients`
    const args = []
    pool.query(sql, args, (err, dbRes) => {
        if (dbRes) {
            res.send(dbRes.rows)
        } else if (err) {
            res.json(err)
        }
    })
})

//initional get
app.get('/recipesInit', function (req, res) {
    const sql = `SELECT * FROM recipes r WHERE r.id BETWEEN 4 AND 50`
    const args = []
    pool.query(sql, args, (err, dbRes) => {
        if (dbRes) {
            res.json(dbRes.rows)
        } else if (err) {
            res.json(err)
        }
    })
})
//get all recipes in DB     
app.get('/fullrecipes' ,gettingArrayOfIngredients ,function(req, res){
    let sql = `SELECT * FROM recipes`
    pool.query(sql, (err, dbRes) => {
        if (dbRes) {
            res.json([dbRes.rows,req.ingredients])
        }else if(err){
            res.send(err)
        }
    })
});

//initail get   
app.get("/", function (req, res) {
    let html = '<h1> Hey User</h1>'
    res.send(html)
})

//ingredients recipes check. 
app.post('/ingredientsCheck' ,gettingRecipeIdByIngredients , function (request , respose) {
    console.log(request.body)
    respose.json(request.body)
})

//methods use for Parsing, - All of my DATA was parsed from :
//https://www.vegan-friendly.co.il/
app.post('/recipesInserting', 
insertIngredientsMiddleware, insertRecipesMiddleware, insertMappingMiddleware, function (request, respose) {
        console.log(`9 Hakunna matata`);
        respose.send('<h1>got it !</h1>');
});

//when use like recipe, This function make sure he didn'y like this recipe before. 
app.post('/like', function (request, respose) {
    const{
        recipe_id,
        user_id
    } = request.body
    console.log(`like id = ${recipe_id}`)
    console.log(`User id = ${user_id}`)
    sql = `INSERT INTO likes(user_id, recipe_id) SELECT * FROM (SELECT '${user_id}', ${recipe_id}) AS tmp
           WHERE NOT EXISTS (SELECT user_id, recipe_id FROM likes
           WHERE user_id = '${user_id}' AND recipe_id = ${recipe_id}) LIMIT 1;`
    //console.log(sql)
    pool.query(sql).then(dbRes => {
        if(dbRes.rowCount == 0){
            respose.send("not in")
        }else if (dbRes.rowCount == 1){
            respose.send("in")
        }
    })
    .catch(err => {console.log(err)})
})

//retrive the recipes that was liked, ORDER BY the number of likes. 
app.get('/bestRecipesId', function(request, respose){
    sql = ` SELECT recipe_id, COUNT(*) like_count 
            FROM likes
            GROUP BY recipe_id
            ORDER BY like_count`
    pool.query(sql).then(dbRes => {
        respose.send(dbRes.rows)
    })
    .catch(err => {console.log(err)})
})


function resetTablesMiddleware(req, res, next) {
    console.log('1 Deleting data from all tables');
    const resetTablesSql = `DELETE FROM recipes; DELETE FROM ingredients; DELETE FROM recipeingredients`;
    pool.query(resetTablesSql).then(dbres => {
        console.log('2 Deleting data completed');
        next();
    })
        .catch(e => {
            next('asone');
        })
        Promise
}

function insertIngredientsMiddleware(req, res, next) {
    const {
        ingredients,
    } = req.body;

    console.log('3 Inserting ingredients');

    let ingredientsIds = [];
    const insertIngredientsSql = `INSERT INTO ingredients (name) VALUES ('${ingredients.join(`'),('`)}') RETURNING id;`
    pool.query(insertIngredientsSql).then(dbRes => {
        for (let i = 0; i < dbRes.rowCount; i++) {
            ingredientsIds.push(dbRes.rows[i].id);
        }

        req.oron = { ingredientsIds };

        console.log(`4 Finished inserting ${ingredientsIds.length} ingredients`);
        next();
    })
        .catch(err => next(err));
}

function insertRecipesMiddleware(req, res, next) {
    console.log(`5 Inserting recipe`);
    const {
        steps,
        name,
        about,
        pic
    } = req.body;
    console.log(name)
    const sql = `INSERT INTO recipes (name, image_url, about, steps) VALUES ('${name}','${pic}','${about}','${JSON.stringify(steps)}') RETURNING id;`;
    pool.query(sql).then(dbRes => {
        if (dbRes.rowCount !== 1) {
            next("Unexpected result from db");
        }
        else {
            req.oron.recipeId = dbRes.rows[0].id;
            console.log(`6 Finished inserting recipe. Id=${req.oron.recipeId}`);
            next();
        }
    }).catch(err => next(err));
}

function insertMappingMiddleware(req, res, next) {
    console.log(`7 Inserting mapping`);
    const sqlBase = 'insert into recipeingredients(recipe_id, ingredient_id) values ';
    let values = [];

    const { recipeId, ingredientsIds } = req.oron;
    for (let i = 0; i < ingredientsIds.length; i++) {
        values.push(`${recipeId}, ${ingredientsIds[i]}`);
    }

    let sql = `${sqlBase} (${values.join('),(')})`;
    pool.query(sql).then(dbRes => {
        console.log(`8 Finished inserting mapping`);
        next();
    })
        .catch(err => next(err));
}

function gettingRecipeIdByIngredients(request, respose, next){
    const ingredients = request.body
    console.log("ingredients to check "+ingredients)
    let code = ""
    for (let index = 0; index < ingredients.length - 1; index++) {
        code = code+`'%${ingredients[index]}%' OR i.name LIKE `
    }
    code = code+`'%${ingredients[ingredients.length - 1]}%'`
    let sql = `SELECT RI.recipe_id FROM ingredients I
               JOIN recipeingredients RI ON I.Id = RI.ingredient_id
               WHERE i.name LIKE ${code} GROUP BY RI.recipe_id
               ORDER BY count(RI.recipe_id) desc`
    
    pool.query(sql).then(dbRes => {
        if (dbRes) {
            let r = []
            for (let index = 0; index < 7; index++) {
                let recipe = dbRes.rows[index]["recipe_id"];
                r.push(recipe)
            }
            request.body = r
            next();
        }
        else {
            console.log("no matching recipes were found")
        }
    }).catch(err => next(err));

}

//used for far (method for getting recipe by ID. 
function getRecipeById(data){
    let code = ""
    for (let index = 0; index < data.length-1; index++) {
        code += `${data[index]} OR id =`
    }
    code += data.length-1
    sql = `SELECT * FROM recipes WHERE id =${code}`
    console.log(sql)
    pool.query(sql).then(dbRes =>{
        if(dbRes){
            console.log(dbRes)
            return dbRes
        }
    })

} 

function sortingIngredients(dbRes){
    let ingredientsArray = []
    for (let i = 0; i < dbRes.rows.length; i++){
        let cell = dbRes.rows[i]
        let id = cell.recipe_id
        let name = cell.name
        if(ingredientsArray[id]){
           ingredientsArray[id].push(name)
        }else{
           ingredientsArray[id] = []
           ingredientsArray[id].push(name)
        }         
    }
    return ingredientsArray
}

function gettingArrayOfIngredients(req, res, next){
    
    let sql = `SELECT I.name, RI.recipe_id 
               FROM ingredients I
               JOIN recipeingredients RI ON I.Id = RI.ingredient_id`
    pool.query(sql, (err, dbRes) => {
        if (dbRes) {
            req.ingredients = sortingIngredients(dbRes)
            next();
        } else if (err) {
            console.log(err)
            res.send(err)
        }
    }) 
}

app.listen(port, () => console.log("Server Started"))
